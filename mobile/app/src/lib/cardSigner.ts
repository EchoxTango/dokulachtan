// Varianta A (eObčanka) — SPEC § 9.4: MOI Podpisové SDK přes BLE čtečku.
// Fyzická čtečka je mimo rozsah této fáze: rozhraní je hotové, implementace
// `StubCardSigner` vrací `reader_not_found` a `FakeCardSigner` umí celý tok
// s testovacím certifikátem (EXPO_PUBLIC_QES_FAKE_CARD=1, SPEC § 15.3).
import { parseP12 } from './crypto/p12';
import { signSignedAttrs, toBase64 } from './crypto/softwareSigner';
import { TEST_P12_PASSWORD, TEST_QSCD_P12_BASE64 } from './testCertificate';

export interface CardContainer {
  id: string;
  label: string;
  certificatePem: string;
  level: 'qes' | 'ades' | 'none';
}

export interface CardCertificate {
  certificatePem: string;
  chainPems: string[];
}

export interface CardSigner {
  readonly kind: 'card';
  initializeSession(): Promise<void>;
  listContainers(): Promise<CardContainer[]>;
  getCertificate(containerId: string): Promise<CardCertificate>;
  signData(containerId: string, dataToSign: Uint8Array, pin?: string): Promise<Uint8Array>;
  finalizeSession(): Promise<void>;
}

export class CardSignerError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

// Zatím jen stub — interakce s fyzickou čtečkou (BLE párování, QPIN dialog).
export class StubCardSigner implements CardSigner {
  readonly kind = 'card' as const;

  async initializeSession(): Promise<void> {
    throw new CardSignerError('reader_not_found');
  }

  async listContainers(): Promise<CardContainer[]> {
    throw new CardSignerError('reader_not_found');
  }

  async getCertificate(): Promise<CardCertificate> {
    throw new CardSignerError('reader_not_found');
  }

  async signData(): Promise<Uint8Array> {
    throw new CardSignerError('reader_not_found');
  }

  async finalizeSession(): Promise<void> {
    return undefined;
  }
}

// Dev mód bez hardwaru: stejné rozhraní, podepisuje testovacím QSCD certem
// (SPEC § 15.3) — server vyžaduje key_location=card => QcSSCD.
export class FakeCardSigner implements CardSigner {
  readonly kind = 'card' as const;

  private parsed: ReturnType<typeof parseP12> | null = null;

  async initializeSession(): Promise<void> {
    this.parsed = parseP12(base64ToBytes(TEST_QSCD_P12_BASE64), TEST_P12_PASSWORD, {
      allowQscd: true,
    });
  }

  async listContainers(): Promise<CardContainer[]> {
    if (!this.parsed) {
      await this.initializeSession();
    }

    return [
      {
        id: 'fake-container-1',
        label: this.parsed!.subject,
        certificatePem: this.parsed!.certificatePem,
        level: 'qes',
      },
    ];
  }

  async getCertificate(_containerId: string): Promise<CardCertificate> {
    if (!this.parsed) {
      await this.initializeSession();
    }

    return {
      certificatePem: this.parsed!.certificatePem,
      chainPems: this.parsed!.chainPems,
    };
  }

  async signData(_containerId: string, dataToSign: Uint8Array): Promise<Uint8Array> {
    if (!this.parsed) {
      await this.initializeSession();
    }

    return signSignedAttrs(this.parsed!.privateKeyPem, dataToSign);
  }

  async finalizeSession(): Promise<void> {
    this.parsed = null;
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function createCardSigner(fakeCard: boolean): CardSigner {
  return fakeCard ? new FakeCardSigner() : new StubCardSigner();
}
