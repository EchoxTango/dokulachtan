import { copyPdf } from '../modules/dokulachtan-open-pdf';
import { resolveSharedPdfFile, sharedPdfFile } from '../src/lib/shareIntent';

jest.mock('../modules/dokulachtan-open-pdf', () => ({ copyPdf: jest.fn() }));

const copyPdfMock = copyPdf as jest.MockedFunction<typeof copyPdf>;

function shareIntent(
  files: {
    path: string;
    fileName: string;
    mimeType: string;
    contentUri?: string;
    size?: number | null;
  }[],
) {
  return {
    files: files.map((file) => ({
      ...file,
      size: file.size ?? null,
      width: null,
      height: null,
      duration: null,
    })),
    text: null,
    webUrl: null,
    type: 'file' as const,
  };
}

describe('sharedPdfFile', () => {
  beforeEach(() => {
    copyPdfMock.mockReset();
  });

  it('vrátí PDF ze share sheetu jako upload', () => {
    expect(
      sharedPdfFile(
        shareIntent([
          { path: 'file:///cache/smlouva.pdf', fileName: 'smlouva.pdf', mimeType: 'application/pdf' },
        ]),
      ),
    ).toEqual({ uri: 'file:///cache/smlouva.pdf', name: 'smlouva.pdf', type: 'application/pdf' });
  });

  it('pozná PDF podle přípony, když MIME chybí', () => {
    expect(
      sharedPdfFile(
        shareIntent([
          {
            path: 'file:///cache/smlouva.PDF',
            fileName: 'smlouva.PDF',
            mimeType: 'application/octet-stream',
          },
        ]),
      ),
    ).toEqual({ uri: 'file:///cache/smlouva.PDF', name: 'smlouva.PDF', type: 'application/pdf' });
  });

  it('ignoruje ne-PDF soubor', () => {
    expect(
      sharedPdfFile(
        shareIntent([{ path: 'file:///cache/foto.jpg', fileName: 'foto.jpg', mimeType: 'image/jpeg' }]),
      ),
    ).toBeNull();
  });

  it('ignoruje prázdný share intent', () => {
    expect(sharedPdfFile(null)).toBeNull();
    expect(sharedPdfFile({ files: null, text: null, webUrl: null, type: null })).toBeNull();
  });

  it('zkopíruje původní contentUri, když je cache kopie prázdná', async () => {
    copyPdfMock.mockResolvedValue({
      uri: 'file:///cache/copied.pdf',
      name: 'smlouva.pdf',
      type: 'application/pdf',
    });

    const result = await resolveSharedPdfFile(
      shareIntent([
        {
          path: 'file:///cache/empty.pdf',
          contentUri: 'content://provider/smlouva.pdf',
          fileName: 'smlouva.pdf',
          mimeType: 'application/pdf',
          size: 0,
        },
      ]),
    );

    expect(result).toEqual({
      uri: 'file:///cache/copied.pdf',
      name: 'smlouva.pdf',
      type: 'application/pdf',
    });
    expect(copyPdfMock).toHaveBeenCalledWith('content://provider/smlouva.pdf', 'smlouva.pdf');
  });

  it('použije platnou cache kopii bez contentUri', async () => {
    const result = await resolveSharedPdfFile(
      shareIntent([
        {
          path: 'file:///cache/smlouva.pdf',
          fileName: 'smlouva.pdf',
          mimeType: 'application/pdf',
          size: 1234,
        },
      ]),
    );

    expect(result).toEqual({
      uri: 'file:///cache/smlouva.pdf',
      name: 'smlouva.pdf',
      type: 'application/pdf',
    });
    expect(copyPdfMock).not.toHaveBeenCalled();
  });
});
