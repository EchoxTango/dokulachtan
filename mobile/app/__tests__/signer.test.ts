import { selectSigner, certificateMatchesLevel } from '../src/lib/signer';

describe('selectSigner (SPEC § 9.8)', () => {
  it('uses the key for an ades field when a key is imported', () => {
    const selection = selectSigner('ades', { hasKey: true, hasReader: false, readerReady: false });

    expect(selection.kind).toBe('key');
    expect(selection.keyLocation).toBe('phone_keystore');
  });

  it('uses the reader for an ades field when only a reader is configured', () => {
    const selection = selectSigner('ades', { hasKey: false, hasReader: true, readerReady: true });

    expect(selection.kind).toBe('card');
    expect(selection.keyLocation).toBe('card');
  });

  it('uses the reader for a qes field even when a key is imported', () => {
    const selection = selectSigner('qes', { hasKey: true, hasReader: true, readerReady: true });

    expect(selection.kind).toBe('card');
  });

  it('sends the user to the wizard when nothing is configured', () => {
    const selection = selectSigner('ades', { hasKey: false, hasReader: false, readerReady: false });

    expect(selection.kind).toBe('wizard');
    expect(selection.reason).toBe('no_signer');
  });

  it('sends the user to the wizard for qes without a reader', () => {
    const selection = selectSigner('qes', { hasKey: true, hasReader: false, readerReady: false });

    expect(selection.kind).toBe('wizard');
    expect(selection.reason).toBe('needs_qes_key');
  });
});

describe('certificateMatchesLevel', () => {
  it('accepts ades and qes for an ades field', () => {
    expect(certificateMatchesLevel('ades', 'ades')).toBe(true);
    expect(certificateMatchesLevel('ades', 'qes')).toBe(true);
  });

  it('accepts only qes for a qes field', () => {
    expect(certificateMatchesLevel('qes', 'qes')).toBe(true);
    expect(certificateMatchesLevel('qes', 'ades')).toBe(false);
    expect(certificateMatchesLevel('qes', 'none')).toBe(false);
  });
});
