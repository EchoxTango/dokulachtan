import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export interface OpenedPdf {
  uri: string;
  name: string;
  type: string;
}

interface NativeOpenPdfModule {
  consumeOpenPdf(): Promise<OpenedPdf | null>;
  copyPdf(uri: string, name: string): Promise<OpenedPdf | null>;
  addListener(event: 'onOpenPdf', listener: (pdf: OpenedPdf) => void): EventSubscription;
}

let native: NativeOpenPdfModule | null = null;

try {
  native = requireNativeModule<NativeOpenPdfModule>('DokulachtanOpenPdf');
} catch {
  native = null;
}

export async function consumeOpenPdf(): Promise<OpenedPdf | null> {
  return native ? native.consumeOpenPdf() : null;
}

export async function copyPdf(uri: string, name: string): Promise<OpenedPdf | null> {
  return native ? native.copyPdf(uri, name) : null;
}

export function addOpenPdfListener(listener: (pdf: OpenedPdf) => void): EventSubscription {
  if (!native) {
    return { remove: () => {} };
  }

  return native.addListener('onOpenPdf', listener);
}
