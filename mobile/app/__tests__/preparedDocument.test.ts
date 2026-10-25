import { createHash } from 'node:crypto';
import forge from 'node-forge';
import { verifyPreparedDocument } from '../src/lib/preparedDocument';
import { preparedPdf, signedAttrs } from './helpers/preparedPdf';

it.each(['sha256', 'sha384', 'sha512'])('cross-checks both payload digests independently for %s', (algorithm) => {
  const { bytes, prepared } = preparedPdf(algorithm);
  const [start, length, secondStart, secondLength] = prepared.byte_range;
  const covered = Buffer.concat([bytes.subarray(start, start + length), bytes.subarray(secondStart, secondStart + secondLength)]);
  const attrs = forge.asn1.fromDer(forge.util.decode64(prepared.data_to_sign));
  const messageDigest = (attrs.value as forge.asn1.Asn1[]).find((attr) => {
    const fields = attr.value as forge.asn1.Asn1[];
    return forge.asn1.derToOid(fields[0].value as string) === '1.2.840.113549.1.9.4';
  })!;
  const values = (messageDigest.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[];

  expect(values[0].value).toBe(createHash(algorithm).update(covered).digest('binary'));
  expect(prepared.document_digest).toBe(createHash('sha256').update(covered).digest('hex'));
  expect(verifyPreparedDocument(bytes, prepared, algorithm))
    .toEqual(new Uint8Array(Buffer.from(prepared.data_to_sign, 'base64')));

  if (algorithm === 'sha384') {
    // SHA-384 pro CMS nesmí změnit pevný SHA-256 kontrakt document_digest.
    expect(() => verifyPreparedDocument(bytes, {
      ...prepared, document_digest: createHash('sha384').update(covered).digest('hex'),
    }, algorithm)).toThrow('document digest');
    // Ani platný document_digest nesmí zakrýt použití SHA-256 v CMS messageDigest.
    expect(() => verifyPreparedDocument(bytes, {
      ...prepared, data_to_sign: signedAttrs(createHash('sha256').update(covered).digest('binary')),
    }, algorithm)).toThrow('signed attributes mismatch');
  }
});
