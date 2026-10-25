# QES test harness (P0.2)

Ověřený postup, jak spustit RSpec forku bez Postgresu i s ním. Vše níže je **změřené**
(2026-10-16), ne odhad.

## Image

```bash
make qes-test-images    # postaví oba image
make qes-test-assets    # zkopíruje buildnuté assety z produkčního image (gitignored)
```

| Image | Dockerfile | Obsah |
|---|---|---|
| `dokulachtan-qes-test` | `test/qes/Dockerfile` | `docuseal:latest` + dev/test gemy (Ruby 4.0.5, `libpdfium.so` z image) |
| `dokulachtan-qes-system-test` | `test/qes/Dockerfile.system` | totéž + `chromium` (capybara/cuprite pro `spec/system`) |

Produkční image má `BUNDLE_WITHOUT=[:development, :test]`, proto se dev/test gemy doinstalovávají
(`BUNDLE_WITHOUT='' bundle install`). Repo forku se mountuje na `/app` (image má vlastní `/app`).

## Spuštění

```bash
make qes-test           # SQLite (jako staging), celá sada kromě spec/system/dashboard_spec.rb
make qes-test-postgres   # Postgres 18 (jako upstream CI), celá sada
make qes-test-qes        # jen QES vrstva (rychlá smyčka; naplní se v P0.3+)
```

## Změřené výsledky

| Běh | DB | Výsledek |
|---|---|---|
| `spec/lib/params` + `spec/jobs` | SQLite | **69 examples, 0 failures** |
| `spec/requests` | SQLite | **38 examples, 0 failures** |
| `spec/lib` + `spec/jobs` + `spec/requests` | SQLite | **107 examples, 0 failures** |
| celá sada včetně `spec/system` | SQLite | 247 examples, 2 failures (viz níže) |
| `make qes-test` (bez dashboard specu) | SQLite | 243 examples, 1 failure (`signing_form_spec.rb:1253`) |
| `make qes-test-postgres` | Postgres 18 | **247 examples, 0 failures** |

## Známé rozdíly proti Postgresu

1. `spec/system/dashboard_spec.rb:53` („searches be submitter email“) — fulltext search. Na SQLite
   tabulka `search_entries` **neexistuje** (migrace `create_search_enties.rb:7` je guardovaná
   `return unless adapter_name == 'PostgreSQL'`) a `SearchEntries.reindex_all` nemá guard
   (`lib/search_entries.rb:10-14`) → `NoMethodError`. V `make qes-test` je proto celý soubor vyloučen.
2. `spec/system/signing_form_spec.rb:1253` (2FA resend) — upstream flake závislý na pořadí/timingu:
   `ActionMailer::Base.deliveries` je prázdné → `nil.body`. Izolovaně projde
   (`rspec spec/system/signing_form_spec.rb:1253` → 1 example, 0 failures) i na Postgresu v celé sadě
   projde. Není to QES kód.

QES vrstva (P0.3+) tyto rozdíly neovlivňuje: nové specy jsou unit/request a `QesSession` používá
jen `t.binary`/`text`/`serialize` + `LockEvent` (`unique: connection.supports_partial_index?`).

## Pasti, na které se narazilo

| Past | Co se stane | Řešení |
|---|---|---|
| `DATABASE_URL=sqlite3:…` | `database.yml` `production:` sekce je pro sqlite URL prázdná → `InvalidConfigurationError` (`database_configurations.rb:261`) | použít **`PRIMARY_DATABASE_URL`** (`environment_value_for` zkusí `PRIMARY_DATABASE_URL` první, `database.yml` zůstane validní) |
| DB v `/tmp` | každý `podman run` má čerstvý `/tmp` → `check_pending_migrations` spadne | DB do repa: `sqlite3:/app/db/qes-test.sqlite3` (gitignored `/db/*.sqlite3`) |
| `db:schema:load` | `db/schema.rb` je Postgres dump (`btree_gin`, `t.tsvector`, `using: :gin`) | jen `db:migrate`; `SCHEMA=/app/tmp/qes-test-schema.rb` (gitignored `/tmp/*`) → `db/schema.rb` zůstane čistý |
| assety pro `spec/system` | shakapacker `compile: true` by chtěl `node_modules` | `make qes-test-assets` (kopie `public/packs` z produkčního image → `public/packs-test`) |
| `podman run -u $(id -u)` | rootless podman mapuje roota na host uid, ne na 1001 | `-u` nepoužívat (root v kontejneru = host uživatel) |
| `bundle exec rspec` v image | image má `BUNDLE_WITHOUT=development:test` | test image z `test/qes/Dockerfile` |

## Mapování na dokumenty

- SPEC § 15.1 (harness), § 22 (kompatibilita), PLAN 0.2 (SQLite) a 0.2b (Postgres parita),
  AGENTS #12.
