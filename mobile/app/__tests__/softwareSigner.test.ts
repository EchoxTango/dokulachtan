import { createVerify, createPublicKey } from 'node:crypto';

import { signSignedAttrs, toBase64 } from '../src/lib/crypto/softwareSigner';
import { parseP12 } from '../src/lib/crypto/p12';
import { TEST_P12_BASE64, TEST_P12_PASSWORD } from '../src/lib/testCertificate';

function testP12(): Uint8Array {
  return Uint8Array.from(atob(TEST_P12_BASE64), (char) => char.charCodeAt(0));
}

describe('signSignedAttrs', () => {
  it('produces an RSASSA-PKCS1-v1_5 signature verifiable with the certificate', () => {
    const parsed = parseP12(testP12(), TEST_P12_PASSWORD);
    const dataToSign = new TextEncoder().encode('signed attributes');

    const signature = signSignedAttrs(parsed.privateKeyPem, dataToSign);

    expect(signature.length).toBe(256);

    const verifier = createVerify('sha256');

    verifier.update(dataToSign);
    verifier.end();

    expect(verifier.verify(createPublicKey(parsed.certificatePem), signature)).toBe(true);
  });

  it('rejects a signature over different data', () => {
    const parsed = parseP12(testP12(), TEST_P12_PASSWORD);
    const signature = signSignedAttrs(parsed.privateKeyPem, new TextEncoder().encode('a'));
    const verifier = createVerify('sha256');

    verifier.update(new TextEncoder().encode('b'));
    verifier.end();

    expect(verifier.verify(createPublicKey(parsed.certificatePem), signature)).toBe(false);
  });

  it('base64 encodes the signature', () => {
    const parsed = parseP12(testP12(), TEST_P12_PASSWORD);
    const signature = signSignedAttrs(parsed.privateKeyPem, new TextEncoder().encode('x'));

    expect(toBase64(signature)).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
