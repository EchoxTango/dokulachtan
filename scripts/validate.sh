#!/usr/bin/env bash
# Ověří fixtures nástroji ekosystému: qpdf, pdfsig (Poppler), pyHanko, openssl.
# Report uloží do test/out/report.txt a vypíše na stdout.
set -euo pipefail

cd "$(dirname "$0")/.."

PYHANKO="${PYHANKO:-.venv/bin/pyhanko}"
TRUST="${TRUST:-test/certs/signer.cert.pem}"
OUT=test/out/report.txt
mkdir -p test/out

run() {
  echo
  echo "## $*"
  "$@" 2>&1 || true
}

{
  echo "# Validační report - $(date -Iseconds)"
  echo
  echo "## Prostředí"
  echo "- qpdf:    $(qpdf --version | head -1)"
  echo "- pdfsig:  $(pdfsig -v 2>&1 | head -1 || echo n/a)"
  echo "- pyhanko: $($PYHANKO --version 2>&1 | head -1)"
  echo "- openssl: $(openssl version)"
  echo "- fork:    $(cat vendor/docuseal.rev 2>/dev/null || echo 'vendor/docuseal nenalezen')"

  for f in test/fixtures/input.pdf \
           test/fixtures/signed-pades-bes.pdf \
           test/fixtures/signed-pades-t.pdf; do
    [ -f "$f" ] || continue
    echo
    echo "# Soubor: $f"
    run qpdf --check "$f"
    run pdfsig "$f"
    run "$PYHANKO" sign validate --trust "$TRUST" "$f"
  done

  if [ -f test/fixtures/sig-detached.der ]; then
    echo
    echo "# Detached CMS: test/fixtures/sig-detached.der"
    echo
    echo "## openssl cms -cmsout -print (signed attributes)"
    openssl cms -cmsout -inform DER -in test/fixtures/sig-detached.der -print 2>/dev/null |
      grep -E "contentType|messageDigest|signingTime|algorithm" || true
    echo
    echo "## openssl pkcs7 -print_certs (cert chain)"
    openssl pkcs7 -inform DER -in test/fixtures/sig-detached.der -print_certs 2>/dev/null || true
  fi
} | tee "$OUT"

echo
echo "OK: report v $OUT"
