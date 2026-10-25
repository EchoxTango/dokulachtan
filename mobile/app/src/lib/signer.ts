// Automatická volba podepisujícího (SPEC § 9.8, rozhodnutí uživatele 2026-10-16):
// pro `qes` vyhrává čtečka, pro `ades` klíč → čtečka → wizard (S10). Bez ptaní.
import type { QesLevel } from './types';

export type SignerKind = 'key' | 'card' | 'wizard';

export interface SignerConfiguration {
  hasKey: boolean;
  hasReader: boolean;
  readerReady: boolean;
  keyLevel?: QesLevel;
}

export interface SignerSelection {
  kind: SignerKind;
  keyLocation?: 'phone_keystore' | 'card';
  reason?: 'no_signer' | 'needs_reader' | 'needs_qes_key';
}

export function selectSigner(
  levelRequired: QesLevel,
  configuration: SignerConfiguration,
): SignerSelection {
  const { hasKey, hasReader, readerReady, keyLevel = 'ades' } = configuration;

  if (levelRequired === 'qes') {
    if (hasReader && readerReady) {
      return { kind: 'card', keyLocation: 'card' };
    }

    return { kind: 'wizard', reason: hasReader ? 'needs_reader' : 'needs_qes_key' };
  }

  if (hasKey) {
    return { kind: 'key', keyLocation: 'phone_keystore' };
  }

  if (hasReader && readerReady) {
    return { kind: 'card', keyLocation: 'card' };
  }

  if (keyLevel === 'qes') {
    return { kind: 'wizard', reason: 'needs_reader' };
  }

  return { kind: 'wizard', reason: hasReader ? 'needs_reader' : 'no_signer' };
}

// Zkontroluje, že lokální certifikát splňuje `level_required` (SPEC § 9.8):
// appka NESMÍ poslat certifikát, který server odmítne (422).
export function certificateMatchesLevel(levelRequired: QesLevel, certificateLevel: QesLevel): boolean {
  if (levelRequired === 'qes') {
    return certificateLevel === 'qes';
  }

  return certificateLevel === 'ades' || certificateLevel === 'qes';
}
