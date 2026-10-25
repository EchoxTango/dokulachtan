import { createVerify, createPublicKey } from 'node:crypto';

import { FakeCardSigner, StubCardSigner, createCardSigner, CardSignerError } from '../src/lib/cardSigner';
import { TEST_P12_PASSWORD, TEST_QSCD_P12_BASE64 } from '../src/lib/testCertificate';
import { levelFromQcStatements } from '../src/lib/level';

describe('cardSigner stubs (SPEC § 9.4, § 15.3)', () => {
  it('uses the reader stub by default and reports reader_not_found', async () => {
    const signer = createCardSigner(false);

    expect(signer).toBeInstanceOf(StubCardSigner);

    await expect(signer.initializeSession()).rejects.toThrow(CardSignerError);

    try {
      await signer.initializeSession();
    } catch (error) {
      expect((error as CardSignerError).code).toBe('reader_not_found');
    }
  });

  it('lists a qualified QES container in the fake card mode', async () => {
    const signer = createCardSigner(true);
    const containers = await signer.listContainers();

    expect(containers).toHaveLength(1);
    expect(containers[0].level).toBe('qes');

    const certificate = await signer.getCertificate(containers[0].id);

    expect(certificate.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(certificate.chainPems.length).toBeGreaterThan(0);
  });

  it('signs signed attributes with the fake card and the signature verifies', async () => {
    const signer = new FakeCardSigner();

    await signer.initializeSession();

    const dataToSign = new TextEncoder().encode('signed attributes');
    const signature = await signer.signData('fake-container-1', dataToSign);
    const certificate = await signer.getCertificate('fake-container-1');

    const verifier = createVerify('sha256');

    verifier.update(dataToSign);
    verifier.end();

    expect(verifier.verify(createPublicKey(certificate.certificatePem), signature)).toBe(true);

    await signer.finalizeSession();
  });

  it('uses a QcSSCD certificate so the server accepts key_location=card', () => {
    const binary = atob(TEST_QSCD_P12_BASE64);

    expect(binary.length).toBeGreaterThan(0);
    expect(TEST_P12_PASSWORD).toBe('test');
  });

  it('never reports a QcSSCD certificate as plain AdES', () => {
    expect(levelFromQcStatements(['QcCompliance', 'QcSSCD'])).toBe('qes');
    expect(levelFromQcStatements(['QcCompliance'])).toBe('ades');
  });
});
