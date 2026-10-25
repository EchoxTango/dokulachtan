// Podpis podepsaných atributů CMS (SPEC § 9.3 bod 5): RSASSA-PKCS1-v1_5, SHA-256.
// `pki.rsa.sign` v node-forge neexistuje — používá se `privateKey.sign(md)`.
import forge from 'node-forge';

import { binaryToUint8, uint8ToBinary } from './p12';

export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512';

export function signSignedAttrs(
  privateKeyPem: string,
  dataToSign: Uint8Array,
  hashAlgorithm: HashAlgorithm = 'sha256',
): Uint8Array {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem) as forge.pki.rsa.PrivateKey;
  const digest = forge.md[hashAlgorithm].create();

  digest.update(uint8ToBinary(dataToSign));

  return binaryToUint8(privateKey.sign(digest));
}

export function toBase64(bytes: Uint8Array): string {
  return forge.util.encode64(uint8ToBinary(bytes));
}
