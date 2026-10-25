#!/usr/bin/env bash
# Ověří, že se lokální hodnoty z .env.local / deploy/smtp.env neobjevují
# v tracked souborech. Hodnoty nikdy nevypisuje, jen název klíče a soubor.
set -euo pipefail

cd "$(dirname "$0")/.."

status=0

for file in .env.local deploy/smtp.env; do
  [ -f "$file" ] || continue

  while IFS='=' read -r key value; do
    case "$key" in ''|\#*) continue ;; esac
    case "$key" in
      SMTP_USERNAME|SMTP_PASSWORD|SMTP_FROM|ADMIN_EMAIL|FORK|BREVO_SENDER_DOMAIN) ;;
      *) continue ;;
    esac
    [ "${#value}" -ge 6 ] || continue

    if git grep -qF -- "$value" -- . ':!mobile/app/package-lock.json'; then
      echo "LEAK: $key z $file je v tracked souborech" >&2
      status=1
    fi
  done < "$file"
done

if ! git check-ignore -q test/certs-private/root.key 2>/dev/null; then
  echo "LEAK: test/certs-private/ není gitignored" >&2
  status=1
fi

exit "$status"
