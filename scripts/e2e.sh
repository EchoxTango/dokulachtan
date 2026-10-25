#!/usr/bin/env bash
# E2E test: rozjede DocuSeal, připraví účet/token/šablonu a spustí API test.
# Použití: ./scripts/e2e.sh
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE=(.venv/bin/podman-compose -f test/e2e/compose.yml -p e2e)
API="${DOCUSEAL_URL:-http://localhost:3000}"
APP=e2e_app_1

running() {
  [ "$(podman inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" = "true" ]
}

if ! running; then
  echo "== startuji DocuSeal =="
  "${COMPOSE[@]}" up -d
fi

echo "== čekám na DocuSeal =="
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$API/up" || true)" = "200" ] && break
  sleep 2
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "$API/up" || true)" = "200" ] || {
  echo "DocuSeal neběží na $API"; exit 1; }

# účet + API token (pokud ještě není nebo přestal platit)
if [ -f .env.docuseal ]; then set -a; . ./.env.docuseal; set +a; fi
if [ -z "${DOCUSEAL_TOKEN:-}" ] ||
   [ "$(curl -s -o /dev/null -w '%{http_code}' -H "X-Auth-Token: $DOCUSEAL_TOKEN" "$API/api/user")" != "200" ]; then
  echo "== vytvářím účet a API token =="
  TOKEN=$(podman exec -w /app "$APP" bin/rails runner - <<'RUBY'
account = Account.first || Account.create!(name: 'E2E', timezone: 'UTC', locale: 'en')
user = account.users.first
if user.nil?
  user = account.users.create!(first_name: 'E2E', last_name: 'Bot',
                              email: 'e2e@example.com', password: 'password123')
  user.confirm if user.respond_to?(:confirm)
  user.save!
end
if account.encrypted_configs.find_by(key: EncryptedConfig::APP_URL_KEY).nil?
  account.encrypted_configs.create!(key: EncryptedConfig::APP_URL_KEY, value: 'http://localhost:3000')
end
if account.encrypted_configs.find_by(key: EncryptedConfig::ESIGN_CERTS_KEY).nil?
  account.encrypted_configs.create!(key: EncryptedConfig::ESIGN_CERTS_KEY,
                                   value: GenerateCertificate.call.transform_values(&:to_pem))
end
puts (user.access_tokens.first || user.access_tokens.create!).token
RUBY
)
  printf 'DOCUSEAL_URL=%s\nDOCUSEAL_TOKEN=%s\n' "$API" "$TOKEN" > .env.docuseal
  set -a; . ./.env.docuseal; set +a
fi

# šablona z fixtures (jednorázově, OSS API šablony vytvářet neumí)
TEMPLATE_ID=$(curl -s -H "X-Auth-Token: $DOCUSEAL_TOKEN" "$API/api/templates" |
  .venv/bin/python -c "import sys,json; print(next((t['id'] for t in json.load(sys.stdin)['data'] if t['name']=='E2E'), ''))")
if [ -z "$TEMPLATE_ID" ]; then
  echo "== vytvářím šablonu E2E =="
  PDF_B64=$(base64 -w0 test/fixtures/input.pdf)
  TEMPLATE_ID=$(podman exec -i -w /app -e "E2E_PDF_B64=$PDF_B64" "$APP" bin/rails runner - <<'RUBY'
require 'base64'
account = Account.first
user = account.users.first
pdf = Base64.decode64(ENV.fetch('E2E_PDF_B64'))
template = account.templates.new(name: 'E2E', author: user, source: :api)
uuid = SecureRandom.uuid
submitter_uuid = SecureRandom.uuid
template.submitters = [{ 'uuid' => submitter_uuid, 'name' => 'Signer' }]
template.schema = [{ 'attachment_uuid' => uuid, 'name' => 'e2e-document' }]
template.fields = [{
  'uuid' => SecureRandom.uuid, 'name' => 'Signature', 'type' => 'signature',
  'required' => true, 'submitter_uuid' => submitter_uuid,
  'areas' => [{ 'x' => 100, 'y' => 700, 'w' => 200, 'h' => 60, 'page' => 1,
                'attachment_uuid' => uuid }]
}]
template.save!
template.documents_attachments.create!(
  uuid: uuid,
  blob: ActiveStorage::Blob.create_and_upload!(io: StringIO.new(pdf), filename: 'e2e-document.pdf')
)
puts template.id
RUBY
)
  printf 'DOCUSEAL_TEMPLATE_ID=%s\n' "$TEMPLATE_ID" >> .env.docuseal
fi

echo "== API e2e test =="
DOCUSEAL_URL="$API" DOCUSEAL_TOKEN="$DOCUSEAL_TOKEN" DOCUSEAL_TEMPLATE_ID="$TEMPLATE_ID" \
  .venv/bin/python scripts/e2e_api.py
