// S4 Žádost o podpis (SPEC § 9.1): deep link → metadata → biometrie → podpis.
import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { QesApi, QesApiError } from '../src/lib/api';
import { runSigningCeremony, CeremonyError } from '../src/lib/ceremony';
import { VaultError } from '../src/lib/crypto/vault';
import { levelLabel } from '../src/lib/level';
import { PdfApi, PdfApiError, loadPdfApiSettings } from '../src/lib/pdfApi';
import { sharePdf } from '../src/lib/pdfShare';
import { platformVaultDeps } from '../src/lib/platform';
import type { QesSessionPayload } from '../src/lib/types';
import { PrimaryButton, SecondaryButton, TextButton } from '../src/ui/buttons';

const SERVER_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://dokulachtan.fly.dev';

const ERROR_TEXT: Record<string, string> = {
  expired_token: 'Platnost odkazu vypršela. Vyžádejte nový.',
  used_token: 'Podpis už byl dokončen.',
  unknown_token: 'Neplatný odkaz. Vyžádejte nový.',
  network: 'Chyba připojení. Zkuste to znovu.',
  certificate_missing: 'Certifikát chybí nebo vypršel. Importujte nový.',
  biometry_rejected: 'Podpis se neprovede bez biometrie.',
  biometry_unavailable: 'V telefonu není nastavená biometrie (otisk/obličej).',
  key_invalidated: 'Klíč byl zneplatněn změnou biometrie. Importujte klíč znovu.',
  vault_unavailable: 'Úložiště klíče není dostupné.',
  vault_decrypt_failed: 'Klíč se nepodařilo odemknout.',
  qes_required_qscd: 'Vyžaduje se kvalifikovaný certifikát (QES).',
  no_signer: 'Nejdřív nastavte podepisování (klíč nebo čtečku).',
  needs_qes_key: 'Pro QES je potřeba čtečka s eObčankou.',
  needs_reader: 'Připojte čtečku a zkuste to znovu.',
  level_mismatch: 'Vybraný certifikát neodpovídá typu podpisu.',
  not_qualified: 'Certifikát není kvalifikovaný.',
  not_trusted: 'Certifikát není důvěryhodný. Použijte certifikát od důvěryhodné CA (I.CA/PostSignum).',
  revoked: 'Certifikát byl revokován.',
  signature_invalid: 'Podpis se nepodařilo ověřit. Zkuste to znovu.',
  wrong_state: 'Požadavek už není platný. Vyžádejte nový odkaz.',
  invalid_pdf: 'Soubor není platné PDF.',
  encrypted_pdf: 'Šifrovaná PDF nejsou podporovaná.',
  already_signed: 'Už podepsaná PDF nejsou podporovaná.',
  file_too_large: 'PDF je příliš velké (max 25 MB).',
  not_authenticated: 'Chybí API token. Nastavte ho v Nastavení.',
  rate_limited: 'Příliš mnoho požadavků. Zkuste to později.',
};

export default function SignScreen() {
  const { token, server, flow, submitter } = useLocalSearchParams<{
    token?: string;
    server?: string;
    flow?: string;
    submitter?: string;
  }>();
  const [session, setSession] = useState<QesSessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [done, setDone] = useState<{ level: string; digest: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  const isPdfFlow = flow === 'pdf';
  // Bez certifikátu nebo podepisujícího vede primární akce do wizardu S10 (docs/17).
  const needsSetup = error === 'certificate_missing' || error === 'vault_decrypt_failed'
    || error === 'key_invalidated' || error === 'no_signer';
  const submitterId = typeof submitter === 'string' && submitter.length > 0 ? Number(submitter) : null;
  const serverUrl = typeof server === 'string' && server.length > 0 ? server : SERVER_URL;

  // Klient pro dokončení submissionu a stažení finálního PDF (docs/15 § 5).
  const pdfApi = useCallback(async () => {
    const settings = await loadPdfApiSettings(platformVaultDeps().storage);

    return new PdfApi(settings?.serverUrl ?? serverUrl, settings?.apiToken ?? '');
  }, [serverUrl]);

  useEffect(() => {
    if (!token) {
      setError('unknown_token');

      return;
    }

    const api = new QesApi(serverUrl, token);

    api
      .getSession()
      .then(setSession)
      .catch((err) => {
        setError(err instanceof QesApiError ? err.code : 'network');
        setErrorDetail(err instanceof Error ? err.message : null);
      });
  }, [token, serverUrl]);

  // Po návratu z wizardu S10 je chyba „chybí certifikát“ vyřešená nebo zastaralá —
  // obrazovka nabídne znovu „Podepsat“ (docs/17).
  useFocusEffect(
    useCallback(() => {
      setError((current) =>
        current === 'certificate_missing' || current === 'vault_decrypt_failed'
          || current === 'key_invalidated' || current === 'no_signer'
          ? null
          : current,
      );
      setErrorDetail(null);
    }, []),
  );

  const sign = useCallback(async () => {
    if (!token) {
      return;
    }

    setSigning(true);
    setError(null);
    setErrorDetail(null);

    try {
      const result = await runSigningCeremony(
        { api: new QesApi(serverUrl, token), vault: platformVaultDeps() },
        session?.level_required ?? 'ades',
      );

      setDone({ level: result.level, digest: result.completed.document_digest });

      // Přímý podpis: dokončit submission v DocuSealu, aby vzniklo finální
      // PDF + auditní stránka ve složce „Direct signing“ (docs/15 § 5).
      if (isPdfFlow && submitterId) {
        await (await pdfApi()).completeSubmission(submitterId);
      }
    } catch (err) {
      if (err instanceof CeremonyError || err instanceof VaultError || err instanceof QesApiError) {
        setError(err.code);
      } else {
        setError('network');
      }

      setErrorDetail(err instanceof Error ? err.message : null);
    } finally {
      setSigning(false);
    }
  }, [token, serverUrl, session, isPdfFlow, submitterId, pdfApi]);

  const shareFinalPdf = useCallback(async () => {
    if (!submitterId) {
      return;
    }

    setSharing(true);
    setShareError(null);

    try {
      const bytes = await (await pdfApi()).downloadDocument(submitterId);
      const name = session?.document_name ?? 'document';

      setShared(await sharePdf(bytes, `${name.replace(/\.pdf$/i, '')}-signed.pdf`));
    } catch (err) {
      setShareError(err instanceof PdfApiError ? err.code : 'network');
    } finally {
      setSharing(false);
    }
  }, [submitterId, session, pdfApi]);

  if (!session && !error) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {done ? (
        <>
          <Text style={styles.title}>Podepsáno ({done.level.toUpperCase()})</Text>
          <Text style={styles.muted}>
            {isPdfFlow
              ? 'PDF je podepsané a uložené v DocuSealu ve složce „Direct signing“. Stáhněte si ho nebo ho nasdílejte.'
              : 'Dokument byl podepsán. Můžete se vrátit do prohlížeče.'}
          </Text>
          <Text style={styles.hash}>{done.digest}</Text>
          {isPdfFlow ? (
            <>
              {shareError ? <Text style={styles.error}>{ERROR_TEXT[shareError] ?? shareError}</Text> : null}
              {shared ? <Text style={styles.detail}>Uloženo: {shared}</Text> : null}
              <PrimaryButton
                title={sharing ? 'Stahuji…' : 'Stáhnout a sdílet'}
                onPress={shareFinalPdf}
                disabled={sharing}
              />
              <SecondaryButton title="Zavřít" onPress={() => router.replace('/')} />
            </>
          ) : (
            <PrimaryButton title="Zavřít" onPress={() => router.replace('/')} />
          )}
        </>
      ) : session ? (
        <>
          <Text style={styles.title}>{session.document_name ?? 'Dokument'}</Text>
          <Text style={styles.muted}>Podepisuje: {session.signer_name}</Text>
          <Text style={styles.label}>Úroveň: {levelLabel(session.level_required)}</Text>
          {error ? <Text style={styles.error}>{ERROR_TEXT[error] ?? error}</Text> : null}
          {errorDetail ? <Text style={styles.detail}>{errorDetail}</Text> : null}
          {needsSetup ? (
            <PrimaryButton title="Nastavit podepisování" onPress={() => router.push('/setup')} />
          ) : (
            <PrimaryButton
              title={signing ? 'Podepisuji…' : 'Podepsat'}
              onPress={sign}
              disabled={signing}
            />
          )}
          <TextButton title="Zrušit" onPress={() => router.replace('/')} />
        </>
      ) : (
        <>
          <Text style={styles.title}>Podpis</Text>
          <Text style={styles.error}>{ERROR_TEXT[error ?? 'unknown_token'] ?? error}</Text>
          {errorDetail ? <Text style={styles.detail}>{errorDetail}</Text> : null}
          <TextButton title="Zavřít" onPress={() => router.replace('/')} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 24, gap: 10, backgroundColor: '#faf7f5', flexGrow: 1 },
  title: { fontSize: 26, fontWeight: '700' },
  muted: { fontSize: 14, color: '#6b7280' },
  label: { fontSize: 13, color: '#6b7280' },
  hash: { fontFamily: 'monospace', fontSize: 11, color: '#374151' },
  error: { color: '#991b1b', fontSize: 14 },
  detail: { color: '#b45309', fontSize: 12 },
});
