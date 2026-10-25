import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { consumeOpenPdf, type OpenedPdf } from '../modules/dokulachtan-open-pdf';

// Expo Router sem pošle `dokulachtan://media/...` z ACTION_VIEW; tady intent
// přečteme, zkopírujeme PDF do cache a přesměrujeme na S14. Když žádné
// otevřené PDF není, zobrazíme běžnou 404.
export default function NotFoundScreen() {
  const [pdf, setPdf] = useState<OpenedPdf | null | undefined>(undefined);
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) {
      return;
    }

    consumed.current = true;
    let active = true;

    void consumeOpenPdf().then((value) => {
      if (active) {
        setPdf(value);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  if (pdf === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (pdf) {
    return <Redirect href={{ pathname: '/verify-pdf', params: { share: pdf.uri, name: pdf.name } }} />;
  }

  return (
    <View style={styles.center}>
      <Text style={styles.title}>Stránka nenalezena</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#faf7f5', padding: 24 },
  title: { fontSize: 20, fontWeight: '700' },
});
