#!/usr/bin/env bash
# Paritní běh RSpec sady forku na Postgresu 18 (jako upstream CI).
#
#   ./scripts/qes-test-postgres.sh [rspec argumenty…]
#
# Používá podman síť se statickou IP (CNI bez DNS pluginu), takže kontejner najde DB na pevné adrese.
# Výsledek se ukládá do test/out/qes-test-postgres-report.txt.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO=vendor/docuseal
IMAGE=${QES_IMAGE:-dokulachtan-qes-system-test}
NET=qes-test-net
SUBNET=10.89.98.0/24
DB_IP=10.89.98.2
DB_NAME=qes_test_db
DB_URL="postgresql://postgres:postgres@${DB_IP}:5432/${DB_NAME}"
CONTAINER=qes-test-postgres-db

mkdir -p test/out

cleanup() {
  podman rm -f "$CONTAINER" >/dev/null 2>&1 || true
  podman network rm -f "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT

podman network exists "$NET" || podman network create --subnet "$SUBNET" "$NET"

podman run -d --rm --name "$CONTAINER" --network "$NET" --ip "$DB_IP" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB="$DB_NAME" \
  docker.io/library/postgres:18 >/dev/null

echo "== čekám na Postgres 18 na ${DB_IP} =="
for _ in $(seq 1 60); do
  if podman exec "$CONTAINER" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "== RSpec (celá sada, Postgres 18) =="
podman run --rm --network "$NET" -v "$PWD/$REPO:/app" -v "$PWD/test:/qes-test:ro" -w /app \
  -e RAILS_ENV=test -e BUNDLE_WITHOUT= -e BUNDLE_GEMFILE=/app/Gemfile \
  -e PRIMARY_DATABASE_URL="$DB_URL" -e SCHEMA=/app/tmp/qes-test-schema-postgres.rb \
  -e HOME=/tmp -e TZ=UTC -e QES_TEST_DIR=/qes-test \
  "$IMAGE" sh -c 'bundle exec rake db:create db:migrate >/dev/null && bundle exec rspec "$@"' _ "$@" \
  2>&1 | tee test/out/qes-test-postgres-report.txt
