// Obřad podpisu v appce (SPEC § 9.3): GET metadata → odemčení vaultu biometrií
// → POST certificate → podepsané atributy → POST complete. Klíč zůstává v zařízení.
import { Platform } from 'react-native';

import { certificateMatchesLevel, selectSigner, type SignerConfiguration } from './signer';
import { signSignedAttrs, toBase64, type HashAlgorithm } from './crypto/softwareSigner';
import { unlockCertificate, type VaultDeps } from './crypto/vault';
import { createCardSigner, type CardSigner } from './cardSigner';
import type {
  QesCompletedPayload,
  QesLevel,
  QesAppMetadata,
  SessionSource,
} from './types';

export interface CeremonyDeps {
  api: SessionSource;
  vault: VaultDeps;
  cardSigner?: CardSigner;
  configuration?: SignerConfiguration;
  app?: QesAppMetadata;
}

export interface CeremonyResult {
  completed: QesCompletedPayload;
  level: QesLevel;
  keyLocation: 'phone_keystore' | 'card';
  biometricPrompts: number;
}

export class CeremonyError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function runSigningCeremony(
  deps: CeremonyDeps,
  levelRequired: QesLevel,
): Promise<CeremonyResult> {
  const session = await deps.api.getSession();
  const required = session.level_required ?? levelRequired;
  const configuration = deps.configuration ?? { hasKey: true, hasReader: false, readerReady: false };
  const selection = selectSigner(required, configuration);

  if (selection.kind === 'wizard') {
    throw new CeremonyError(selection.reason ?? 'no_signer');
  }

  const app: QesAppMetadata = deps.app ?? {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    version: '1.0.0',
    reader: null,
    container_ref: null,
  };

  if (selection.kind === 'card') {
    const cardSigner = deps.cardSigner ?? createCardSigner(false);

    await cardSigner.initializeSession();

    try {
      const card = await cardSigner.getCertificate('');
      const containers = await cardSigner.listContainers();
      const chain = card.chainPems.map((pem) => toBase64(pemCertificateToDer(pem)));

      return await completeWithCertificate(deps, card.certificatePem, chain, {
        ...app,
        reader: 'moi-sdk',
        container_ref: containers[0]?.id ?? null,
      }, (dataToSign) => cardSigner.signData('', dataToSign));
    } finally {
      await cardSigner.finalizeSession();
    }
  }

  const material = await unlockCertificate(deps.vault, 'sign');

  if (!certificateMatchesLevel(required, material.info.level)) {
    throw new CeremonyError('qes_required_qscd');
  }

  const chain = material.chainPems.map((pem) => toBase64(pemCertificateToDer(pem)));

  return completeWithCertificate(deps, material.certificatePem, chain, app, (dataToSign) =>
    Promise.resolve(signSignedAttrs(material.privateKeyPem, dataToSign, session.hash_algorithm as HashAlgorithm)),
  );
}

async function completeWithCertificate(
  deps: CeremonyDeps,
  certificatePem: string,
  chain: string[],
  app: QesAppMetadata,
  sign: (dataToSign: Uint8Array) => Promise<Uint8Array>,
): Promise<CeremonyResult> {
  const certificateDer = pemCertificateToDer(certificatePem);
  const prepared = await deps.api.postCertificate({
    certificate: toBase64(certificateDer),
    chain,
    key_location: app.reader ? 'card' : 'phone_keystore',
    app,
  });

  const dataToSign = fromBase64(prepared.data_to_sign);
  const signature = await sign(dataToSign);

  const completed = await deps.api.postComplete(toBase64(signature));

  return {
    completed,
    level: completed.level,
    keyLocation: app.reader ? 'card' : 'phone_keystore',
    biometricPrompts: 1,
  };
}

function pemCertificateToDer(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s+/g, '');

  return fromBase64(base64);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
