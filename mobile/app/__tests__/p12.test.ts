import { parseP12, P12Error } from '../src/lib/crypto/p12';
import { TEST_P12_BASE64, TEST_P12_PASSWORD } from '../src/lib/testCertificate';

function testP12(): Uint8Array {
  return Uint8Array.from(atob(TEST_P12_BASE64), (char) => char.charCodeAt(0));
}

describe('parseP12', () => {
  it('parses the embedded test certificate as AdES with a signing key', () => {
    const parsed = parseP12(testP12(), TEST_P12_PASSWORD);

    expect(parsed.level).toBe('ades');
    expect(parsed.qcStatements).toEqual(['QcCompliance']);
    expect(parsed.keyType).toBe('rsa');
    expect(parsed.keySize).toBe(2048);
    expect(parsed.canSign).toBe(true);
    expect(parsed.subject).toContain('signer-ades');
    expect(parsed.privateKeyPem).toContain('BEGIN RSA PRIVATE KEY');
  });

  it('rejects a wrong password', () => {
    expect(() => parseP12(testP12(), 'wrong')).toThrow(P12Error);

    try {
      parseP12(testP12(), 'wrong');
    } catch (error) {
      expect((error as P12Error).code).toBe('wrong_password');
    }
  });

  it('rejects a QcSSCD certificate (phone is not a QSCD)', () => {
    const qscd = require('fs').readFileSync(
      `${__dirname}/../../../test/certs/pki/signer-qscd.p12`,
    );

    expect(() => parseP12(new Uint8Array(qscd), 'test')).toThrow(P12Error);

    try {
      parseP12(new Uint8Array(qscd), 'test');
    } catch (error) {
      expect((error as P12Error).code).toBe('qscd_certificate');
    }
  });
});
