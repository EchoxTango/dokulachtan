// Sdílení finálního PDF (docs/15 § 7.1): zápis do cache a systémový share
// sheet / uložení. Uživatel rozhoduje, kam PDF jde.
// `mimeType` je pro Android, `UTI` pro iOS (expo-sharing je platformová volba).
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export async function sharePdf(bytes: Uint8Array, fileName: string): Promise<string> {
  const file = new File(Paths.cache, fileName);

  file.create({ overwrite: true });
  file.write(bytes);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Podepsané PDF',
    });
  }

  return file.uri;
}
