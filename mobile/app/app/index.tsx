// S1 Home (SPEC § 9.1, docs/17): stav certifikátu a akce podle toho, co uživatel
// potřebuje nejčastěji — s klíčem podpis PDF, bez klíče import.
import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { certificateSummary, type StoredCertificateInfo } from '../src/lib/crypto/vault';
import { levelLabel } from '../src/lib/level';
import { platformVaultDeps } from '../src/lib/platform';
import { PrimaryButton, SecondaryButton, TextButton } from '../src/ui/buttons';

const EXPIRING_DAYS = 30;

export default function HomeScreen() {
  const router = useRouter();
  const [info, setInfo] = useState<StoredCertificateInfo | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      certificateSummary(platformVaultDeps()).then((summary) => {
        if (active) {
          setInfo(summary);
        }
      });

      return () => {
        active = false;
      };
    }, []),
  );

  const expiring = info ? new Date(info.notAfter).getTime() - Date.now() < EXPIRING_DAYS * 86400000 : false;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Dokulachtan</Text>
      <Text style={styles.subtitle}>Podepisujte certifikátem, klíč zůstává ve vašem zařízení.</Text>

      {info ? (
        <TouchableOpacity
          style={styles.card}
          onPress={() => router.push('/certificate')}
          accessibilityRole="button"
          accessibilityHint="Otevře detail certifikátu"
        >
          <View style={styles.cardHeader}>
            <Text style={styles.label}>Certifikát</Text>
            <Text style={styles.cardLink}>Spravovat ›</Text>
          </View>
          <Text style={styles.value}>{info.subject}</Text>
          <Text style={styles.muted}>
            {levelLabel(info.level)} · {info.keyType.toUpperCase()} {info.keySize} · do{' '}
            {new Date(info.notAfter).toLocaleDateString('cs-CZ')}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.card}>
          <Text style={styles.label}>Certifikát</Text>
          <Text style={styles.muted}>Žádný certifikát</Text>
        </View>
      )}

      {expiring ? (
        <View style={styles.warningCard}>
          <Text style={styles.warning}>Platnost certifikátu brzy vyprší.</Text>
          <TextButton
            title="Importovat nový"
            onPress={() => router.push('/import')}
            style={styles.warningAction}
          />
        </View>
      ) : null}

      {info ? (
        <PrimaryButton title="Podepsat PDF" onPress={() => router.push('/sign-pdf')} />
      ) : (
        <PrimaryButton title="Importovat klíč (PKCS#12)" onPress={() => router.push('/import')} />
      )}

      <SecondaryButton title="Ověřit PDF" onPress={() => router.push('/verify-pdf')} />

      <View style={styles.tertiaryRow}>
        {Platform.OS === 'android' ? (
          <TextButton title="Připojit čtečku" onPress={() => router.push('/reader')} />
        ) : null}
        <TextButton title="Nastavení" onPress={() => router.push('/settings')} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12, backgroundColor: '#faf7f5', flexGrow: 1 },
  title: { fontSize: 28, fontWeight: '700' },
  subtitle: { fontSize: 15, color: '#6b7280', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, color: '#6b7280' },
  value: { fontSize: 16, fontWeight: '600' },
  muted: { fontSize: 14, color: '#6b7280' },
  cardLink: { fontSize: 14, color: '#291334', fontWeight: '600' },
  warningCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 2 },
  warning: { fontSize: 14, color: '#b45309' },
  warningAction: { alignSelf: 'flex-start', paddingHorizontal: 0, paddingVertical: 4 },
  tertiaryRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4 },
});
