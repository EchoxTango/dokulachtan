// PDF ze share sheetu (docs/15 § 6): Android předá sdílený soubor jako
// `file://` cestu v cache appky (expo-share-intent). Bereme jen PDF — podle
// MIME nebo přípony; ostatní soubory ignorujeme (do share sheetu se appka
// nabízí jen pro application/pdf).
import type { ShareIntent } from 'expo-share-intent';

import { copyPdf } from '../../modules/dokulachtan-open-pdf';
import type { PdfUpload } from './pdfApi';

type SharedFile = NonNullable<ShareIntent['files']>[number] & { contentUri?: string };

function findPdf(shareIntent: ShareIntent | null): SharedFile | null {
  return (
    shareIntent?.files?.find(
      (item) => item.mimeType === 'application/pdf' || /\.pdf$/i.test(item.fileName ?? ''),
    ) ?? null
  );
}

export function sharedPdfFile(shareIntent: ShareIntent | null): PdfUpload | null {
  const file = findPdf(shareIntent);

  if (!file?.path) {
    return null;
  }

  return {
    uri: file.path,
    name: file.fileName || 'document.pdf',
    type: 'application/pdf',
  };
}

// `expo-share-intent` někdy vytvoří prázdnou cache kopii; původní soubor
// zůstává v `contentUri`. Ten zkopírujeme nativním modulem do cache.
export async function resolveSharedPdfFile(
  shareIntent: ShareIntent | null,
): Promise<PdfUpload | null> {
  const file = findPdf(shareIntent);

  if (!file) {
    return null;
  }

  const contentUri = (file as SharedFile).contentUri;

  if (contentUri) {
    const copied = await copyPdf(contentUri, file.fileName || 'document.pdf');

    if (copied) {
      return { uri: copied.uri, name: copied.name, type: 'application/pdf' };
    }
  }

  if (!file.path) {
    return null;
  }

  return {
    uri: file.path,
    name: file.fileName || 'document.pdf',
    type: 'application/pdf',
  };
}
