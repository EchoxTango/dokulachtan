#!/usr/bin/env bash
# Vygeneruje testovací self-signed certifikát + PKCS#12 pro E2E testy.
# Není to kvalifikovaný certifikát (QSCD), slouží jen k testům pipeline.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f test/certs/signer.p12 ] && [ "${FORCE:-0}" != "1" ]; then
  echo "test/certs/signer.p12 už existuje (FORCE=1 pro přegenerování)"
  exit 0
fi

mkdir -p test/certs

openssl req -x509 -newkey rsa:2048 \
  -keyout test/certs/signer.key.pem \
  -out test/certs/signer.cert.pem \
  -days 3650 -nodes \
  -subj "/C=CZ/O=Dokulachtan Test/CN=Test Signer"

openssl pkcs12 -export \
  -out test/certs/signer.p12 \
  -inkey test/certs/signer.key.pem \
  -in test/certs/signer.cert.pem \
  -passout pass:test

echo "OK: test/certs/signer.{key.pem,cert.pem,p12} (heslo: test)"
