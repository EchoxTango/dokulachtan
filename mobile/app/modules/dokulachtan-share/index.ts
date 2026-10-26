// Systémový share sheet, otevření a uložení finálního PDF do telefonu
// (docs/15 § 7.1).
//
// `expo-sharing` na Androidu spouští chooser z vlákna na pozadí: někdy rejectuje
// NPE (`dispatchCancelPendingInputEvents`, expo/expo#51164) a někdy promise po
// návratu ze sheetu zůstane viset, takže tlačítko „Sdílet“ zůstane mrtvé.
// Vlastní modul startuje chooser na hlavním vlákně a promise resolve hned po
// otevření sheetu — appka na zavření sheetu nečeká. Na iOS zůstává `expo-sharing`.
import { requireNativeModule } from 'expo-modules-core';

export interface NativeSavedPdf {
  uri: string;
  label: string;
}

interface NativeShareModule {
  sharePdf(uri: string, mimeType: string, title: string): Promise<void>;
  saveToDownloads(uri: string, fileName: string, mimeType: string): Promise<NativeSavedPdf>;
  openPdf(uri: string, mimeType: string): Promise<void>;
}

let native: NativeShareModule | null = null;

try {
  native = requireNativeModule<NativeShareModule>('DokulachtanShare');
} catch {
  native = null;
}

export function isNativeShareAvailable(): boolean {
  return native !== null;
}

export async function sharePdf(uri: string, mimeType: string, title: string): Promise<void> {
  await native?.sharePdf(uri, mimeType, title);
}

export async function saveToDownloads(uri: string, fileName: string, mimeType: string): Promise<NativeSavedPdf> {
  if (!native) {
    throw new Error('saveToDownloads is not available');
  }

  return native.saveToDownloads(uri, fileName, mimeType);
}

export async function openPdf(uri: string, mimeType: string): Promise<void> {
  if (!native) {
    throw new Error('openPdf is not available');
  }

  await native.openPdf(uri, mimeType);
}
