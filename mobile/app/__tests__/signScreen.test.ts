import React from 'react';
import { QesApi } from '../src/lib/api';
import { PdfApi } from '../src/lib/pdfApi';
import { runSigningCeremony } from '../src/lib/ceremony';
import SignScreen from '../app/sign';

const { create, act } = require('react-test-renderer');
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ token: 'tok', flow: 'pdf', submitter: '42' }),
  useFocusEffect: () => {}, router: { replace: jest.fn() },
}));
jest.mock('../src/lib/platform', () => ({ platformVaultDeps: () => ({ storage: {} }) }));
jest.mock('../src/lib/pdfShare', () => ({ sharePdf: jest.fn(), previewPdf: jest.fn() }));
jest.mock('../src/lib/signingOrigin', () => ({
  ...jest.requireActual('../src/lib/signingOrigin'), resolveSigningOrigin: async () => 'https://server',
}));
jest.mock('../src/lib/pdfApi', () => ({
  ...jest.requireActual('../src/lib/pdfApi'),
  loadPdfApiSettings: async () => ({ serverUrl: 'https://server', apiToken: 'token' }),
}));
jest.mock('../src/lib/ceremony', () => ({
  ...jest.requireActual('../src/lib/ceremony'), runSigningCeremony: jest.fn(),
}));

beforeEach(() => {
  jest.spyOn(QesApi.prototype, 'getSession').mockResolvedValue({
    state: 'app_opened', session_id: 1, provider: 'app', document_name: 'Contract', signer_name: 'Signer',
    hash_algorithm: 'sha256', level_required: 'ades', requires_certificate: true, server_url: 'https://server', expires_at: null,
  });
  jest.mocked(runSigningCeremony).mockResolvedValue({
    completed: { state: 'completed', session_id: 1, level: 'ades', document_digest: 'digest', signed_pdf_sha256: 'hash' },
    level: 'ades', keyLocation: 'phone_keystore', biometricPrompts: 1,
  });
});
afterEach(() => { jest.restoreAllMocks(); jest.clearAllMocks(); });

it('offers saving retry after a signature and retries only submission completion', async () => {
  const complete = jest.spyOn(PdfApi.prototype, 'completeSubmission')
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  let screen: ReturnType<typeof create>;
  await act(async () => { screen = create(React.createElement(SignScreen)); });
  await act(async () => { await screen.root.findByProps({ title: 'Zkontrolovat dokument' }).props.onPress(); });
  expect(screen.root.findByProps({ title: 'Dokončit uložení' })).toBeTruthy();
  expect(screen.root.findAllByProps({ title: 'Stáhnout a sdílet' })).toHaveLength(0);
  await act(async () => { await screen.root.findByProps({ title: 'Dokončit uložení' }).props.onPress(); });
  expect(screen.root.findByProps({ title: 'Stáhnout a sdílet' })).toBeTruthy();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(complete).toHaveBeenLastCalledWith(42);
  expect(runSigningCeremony).toHaveBeenCalledTimes(1);
  await act(async () => screen.unmount());
});

it('opens a completed link directly as success and finishes only saving', async () => {
  jest.mocked(QesApi.prototype.getSession).mockResolvedValue({
    state: 'completed', session_id: 1, level: 'ades', document_digest: 'digest', signed_pdf_sha256: 'hash',
  });
  const complete = jest.spyOn(PdfApi.prototype, 'completeSubmission').mockResolvedValue(undefined);
  let screen: ReturnType<typeof create>;
  await act(async () => { screen = create(React.createElement(SignScreen)); });
  expect(screen.root.findByProps({ title: 'Stáhnout a sdílet' })).toBeTruthy();
  expect(complete).toHaveBeenCalledTimes(1);
  expect(runSigningCeremony).not.toHaveBeenCalled();
  await act(async () => screen.unmount());
});
