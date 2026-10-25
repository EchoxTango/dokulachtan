import { QesApi, QesApiError } from '../src/lib/api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('QesApi', () => {
  it('loads the session metadata', async () => {
    const calls: string[] = [];
    const api = new QesApi('https://server', 'tok', {
      serverUrl: 'https://server',
      fetchImpl: (async (url, init) => {
        calls.push(`${init?.method} ${url}`);

        return jsonResponse({ session_id: 1, state: 'app_opened', level_required: 'ades' });
      }) as typeof fetch,
    });

    const session = await api.getSession();

    expect(session.level_required).toBe('ades');
    expect(calls).toEqual(['GET https://server/qes/sessions/tok']);
  });

  it('posts the certificate and returns data_to_sign', async () => {
    const api = new QesApi('https://server', 'tok', {
      serverUrl: 'https://server',
      fetchImpl: (async () => jsonResponse({ data_to_sign: 'AAA=', hash_algorithm: 'sha256' })) as typeof fetch,
    });

    const payload = await api.postCertificate({
      certificate: 'AAA=',
      chain: [],
      key_location: 'phone_keystore',
      app: { platform: 'android', version: '1.0.0' },
    });

    expect(payload.data_to_sign).toBe('AAA=');
  });

  it('maps 410 expired_token to a typed error', async () => {
    const api = new QesApi('https://server', 'tok', {
      serverUrl: 'https://server',
      fetchImpl: (async () =>
        jsonResponse({ error: 'expired_token', message: 'expired' }, 410)) as typeof fetch,
    });

    await expect(api.getSession()).rejects.toThrow(QesApiError);

    try {
      await api.getSession();
    } catch (error) {
      expect((error as QesApiError).code).toBe('expired_token');
      expect((error as QesApiError).status).toBe(410);
    }
  });

  it('maps 422 qes_required_qscd to a typed error', async () => {
    const api = new QesApi('https://server', 'tok', {
      serverUrl: 'https://server',
      fetchImpl: (async () =>
        jsonResponse({ error: 'qes_required_qscd', message: 'QES required' }, 422)) as typeof fetch,
    });

    try {
      await api.postCertificate({
        certificate: 'AAA=',
        chain: [],
        key_location: 'phone_keystore',
        app: { platform: 'android', version: '1.0.0' },
      });
    } catch (error) {
      expect((error as QesApiError).code).toBe('qes_required_qscd');
    }
  });
});
