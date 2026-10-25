#!/usr/bin/env bash
# Vytvoří fixtures pro E2E testy: vstupní PDF + PAdES-BES, PAdES-B-T a detached CMS.
# Používá pyHanko CLI z .venv a testovací certifikát z scripts/make_test_pki.sh.
#
# TSA_URL lze přepsat (např. I.CA test TSA, PostSignum test TSA):
#   TSA_URL=https://tsa.ica.cz/... ./scripts/make_fixtures.sh
set -euo pipefail

cd "$(dirname "$0")/.."

PYHANKO="${PYHANKO:-.venv/bin/pyhanko}"
PASSFILE="$(mktemp)"
printf 'test\n' > "$PASSFILE"
trap 'rm -f "$PASSFILE"' EXIT

TSA_URL="${TSA_URL:-http://freetsa.org/tsr}"

./scripts/make_test_pki.sh
mkdir -p test/fixtures
.venv/bin/python scripts/make_test_pdf.py test/fixtures/input.pdf

# PAdES-B-B (baseline, bez časového razítka)
"$PYHANKO" sign addsig \
  --field Sig1 --use-pades \
  --reason "E2E test QES pipeline" --name "Test Signer" \
  pkcs12 test/fixtures/input.pdf test/fixtures/signed-pades-bes.pdf \
  test/certs/signer.p12 --passfile "$PASSFILE"

# PAdES-B-T (s kvalifikovaným časovým razítkem)
"$PYHANKO" sign addsig \
  --field Sig1 --use-pades --timestamp-url "$TSA_URL" \
  --reason "E2E test QES pipeline" \
  pkcs12 test/fixtures/input.pdf test/fixtures/signed-pades-t.pdf \
  test/certs/signer.p12 --passfile "$PASSFILE"

# Detached CMS (kontrola "co produkujeme" nástroji ekosystému)
"$PYHANKO" sign addsig \
  --use-pades --detach \
  pkcs12 test/fixtures/input.pdf test/fixtures/sig-detached.der \
  test/certs/signer.p12 --passfile "$PASSFILE"

echo "OK: fixtures v test/fixtures/"
ls -la test/fixtures/
