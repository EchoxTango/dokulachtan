# 11 — Audit DESIGN.md a SPEC.md (připravenost na implementaci)

Datum: 2026-10-16
Metoda: dokumenty vs. reálný kód forku v commitu `vendor/docuseal` (`3c65b0e`, Rails 8.1.3.1, HexaPDF 1.7.0),
`test/certs`, `scripts/`, Makefile a CI. Každý nález má odkaz na soubor:řádek.

**Verdikt: DESIGN je v pořádku a v souladu se SPEC. SPEC je z ~85 % implementovatelná, ale
obsahuje 6 blokátorů (B1–B6), které je nutné rozhodnout/opravit dřív, než se začne psát kód fází P1–P3.
Fáze P0 je popsána technicky nesprávně (SQLite + `bundle install`).**

Legenda: ✅ ověřeno v kódu · ⚠️ nutné rozhodnout · ❌ rozpor/blokátor

---

## 1. Blokátory (vyřešit před P1/P2/P3)

### B1 ❌ Životní cyklus tokenu si odporuje: smazání `token_digest` vs. `410 used_token` vs. idempotence

- SPEC § 4.3: „`token_digest` se maže (`NULL`) při přechodu do `completed`/`failed`/`expired`/`cancelled`“.
- SPEC § 5.6 + § 19: `410 used_token` („token už byl použit“).
- SPEC § 7.10: opakované `POST /complete` se stejnou signaturou → **200 + stejný výsledek**; „app po chybě sítě
  znovu načte `GET /qes/sessions/:token` a zobrazí skutečný stav“.

Když je digest po dokončení smazaný, server session podle tokenu **nenajde** → vrátí `404 unknown_token`,
nikdy `410 used_token`, a idempotentní replay ani obnova stavu appkou nejsou možné. To se týká i prohlížeče
(polling po `completed` běží dál, SPEC § 6.2).

**Doporučení:** `token_digest` držet do `expires_at` (nebo přidat `used_at`), `410 used_token` odvozovat od stavu
(`completed`/`failed`/`cancelled`), a po expiraci digest teprve mazat (job). Sladit § 4.3, § 5.6 a § 7.10.

### B2 ❌ Pečeť se může aplikovat dvakrát → 3 signatury ve finálním PDF

- SPEC § 7.6: `Qes::Seal.apply` → `final_document` (podpis appky + pečeť = 2 signatury) → jde do `documents` (§ 7.7).
- SPEC § 7.7: `GenerateCombinedAttachment#build_combined_pdf` pro QES vrátí podepsané PDF (ř. 61).
- Ale `Submissions::GenerateCombinedAttachment#call` (`lib/submissions/generate_combined_attachment.rb:7`) po `build_combined_pdf`
  **vždy** volá `sign_pdf` (ř. 34) s PKCS účtu → na už podepsaný/opečetněný dokument přidá **další** pečeť.
  Výsledný `combined_document` by měl 3 signatury, což rozbíjí kritérium SPEC § 15.2 bod 6 („dvě signatury“).

Navíc není rozhodnuto, který artefakt je „finální PDF v DocuSealu“: `documents` (per submitter, `Qes::ResultAttachments`)
vs. `combined_document` (výchozí pro stažení, viz `Submitters.select_attachments_for_download`, `lib/submitters.rb:99`).

**Doporučení:** zvolit jednu variantu a zapsat ji do SPEC:
(a) pečeť aplikuje jen upstream signing v `GenerateCombinedAttachment#call` a `Qes::Seal` se neimplementuje, nebo
(b) pečeť aplikuje `Qes::Seal` do `documents` a `combined_document` se pro QES **kopíruje bez dalšího podpisu**
(hook i v `call`, ne jen v `build_combined_pdf`). Zároveň specifikovat, který artefakt validuje § 15.2 (např. `documents`, ne `?merge=true`).

### B3 ❌ Patch `_value.html.erb` podle SPEC § 7.7 je neplatné Ruby

SPEC i PLAN 3.9 předepisují `next if field['type'] == 'qes'` do `app/views/submissions/_value.html.erb:9`.
ActionView kompiluje partial přes `mod.module_eval(compiled_source, …)` a `compiled_source` obaluje tělo do
`def <method>(local_assigns, output_buffer, …) … end` (`actionview-8.1.3.1/lib/action_view/template.rb:449, 508`).
`next` uvnitř `def` bez bloku je `SyntaxError` (Invalid next) → stránka přestane fungovat.

**Doporučení:** v `_value.html.erb` použít `return if field['type'] == 'qes'` (return z metody šablony je platný),
nebo celé tělo obalit do `<% if field['type'] != 'qes' %> … <% end %>`. Pozor: stejná úprava nesmí rozbít
ostatní typy polí.

### B4 ❌ HexaPDF 1.7 pro PAdES **nepřidá `signing-time`** do podepsaných atributů

SPEC § 7.2 vyžaduje v `SignerInfo`: `content-type`, `message-digest`, `signing-time`, `signingCertificateV2`
a tvrdí, že `signing_time` musí být explicitní, aby fáze 2 vytvořila identické atributy.

V `hexapdf-1.7.0/lib/hexapdf/digital_signature/signing/signed_data_creator.rb:111-113`:
```ruby
def create(data, type: :cms, &block)
  signed_attrs = create_signed_attrs(data, signing_time: (type == :cms))
```
Pro `type: :pades` (co SPEC vyžaduje kvůli `SubFilter = ETSI.CAdES.detached`) je `signing_time` **false**
→ atribut `id-signingTime` v CMS **není**. `signing_time:` se propíše jen do `/M` v podpisovém slovníku
(`default_handler.rb:270`).

**Doporučení:** v podtřídě `Qes::PlaceholderSignedDataCreator` přepsat i `create_signed_attrs` (vynutit `signing_time: true`),
nebo v SPEC § 7.2 přesně popsat skutečnou množinu atributů a rozhodnout, zda `signing-time` v PAdES vyžadujeme
(PAdES baseline B-B ho vyžaduje). Ověřit v P2.4 reálným výstupem, ne předpokladem.

### B5 ❌ Hodnotu pole `qes` nikdo nevaliduje → obřad lze obejít

SPEC § 4.4/§ 4.5: hodnota `submitter.values[qes_uuid] = "qes:<session_id>"`, kterou nastaví server při `completed`,
a prohlížeč ji pošle zpět. Upstream `Submitters::SubmitValues` ale kontroluje jen **přítomnost** hodnoty
(`lib/submitters/submit_values.rb:95`), ne její formát ani existenci dokončené `QesSession`
(`lib/submitters/normalize_values.rb:90-107` vrátí hodnotu beze změny, `qes` není v žádném seznamu typů).

Klient tedy může poslat `values[qes_uuid] = "x"` (přes formulář i API) a submission se dokončí **bez** certifikátu
a bez podpisu; `GenerateResultAttachments#call` vygeneruje nepodepsané PDF a hook na `qes_sessions.completed`
se neuplatní. „QES pole MUSÍ být vyplněné před completed“ (SPEC § 4.4) tím padá.

**Doporučení:** přidat serverovou validaci (nový hook, který v SPEC § 7.7/§ 14 chybí): hodnota `qes` musí odpovídat
`\Aqes:\d+\z` a session musí být pro daného submittera `completed`. Místo: `lib/submitters/submit_values.rb`
(`validate_values!`) nebo `app/models/submitter.rb`. Zároveň to je 13. upstream změna, kterou tabulka § 7.7 neuvádí.

### B6 ❌ Fáze P0 je technicky popsána špatně (SQLite + `bundle install`)

- `config/database.yml:2` má default `adapter: postgresql`; `test:` (ř. 11) i `development:` (ř. 7) dědí PostgreSQL.
  SQLite je jen produkční fallback bez `DATABASE_URL` (`database.yml:16-19`), takže PLAN 0.2 („SQLite, bez Postgresu,
  `db.sqlite3` se vytvoří“) v původním znění neplatil — ale **SQLite je pro dev/test správná volba**
  (staging = SQLite, dev/prod parita), jen se musí zapnout správně:
  `DATABASE_URL=sqlite3:db/test.sqlite3` (Rails `UrlConfig` merguje URL hash přes yml — `url_config.rb:44`,
  `database_configurations.rb:288-309`) a **`SCHEMA=/tmp/qes-test-schema.rb`**, protože gem default
  `ActiveRecord.dump_schema_after_migration = true` (`activerecord.rb:426`) a DocuSeal ho vypíná jen
  v `production.rb:127` → `db:migrate` by jinak přepsal `db/schema.rb` SQLite dumpem.
  Na SQLite nelze `db:schema:load` (`db/schema.rb` má `enable_extension "btree_gin"`, `t.tsvector`,
  `using: :gin`), jen `db:migrate` — a to jde: všechny 3 Postgres-specific migrace jsou guardované
  `return unless adapter_name == 'PostgreSQL'` (`create_search_enties.rb:7,39`, `add_ngram_to_search_index.rb:5`,
  `add_submissions_account_template_statistics.rb:5`).
- `Gemfile:5` `ruby '4.0.5'`; na vývojovém stroji **není žádné Ruby** (`ruby: command not found`).
- Upstream RSpec job (`.github/workflows/ci.yml:111-169`) potřebuje: Postgres 18, `yarn install`, `libvips`,
  `leptonica`, `chromium`, `libpdfium.so` (pinned release, `Dockerfile:12-18`) a `rake assets:precompile`.
  Bez `libpdfium.so` nefunguje `VerifyPdfSignature` (`lib/pdfium.rb:9-19`), tedy ani `Qes::Validator`.
  (Assety v testu kompiluje i shakapacker `compile: true`, `config/shakapacker.yml`; `chromium` je jen
  pro `spec/system/*`.)
- **Jediný spec závislý na Postgresu** je `spec/system/dashboard_spec.rb:53` (fulltext: `SearchEntries.reindex_all`
  a `visit root_path(q: …)`; tabulka `search_entries` na SQLite neexistuje a `reindex_all` nemá guard).
- P0.4 je zbytečná práce: `scripts/make_test_pki_crl.py:24-28,102-104` už QCStatements (QcCompliance, QcSSCD)
  generuje a `test/certs/pki/signer-ades.crt` / `signer-qscd.crt` je mají.

**Doporučení:** v P0.2/P0.5 popsat reálný harness: dev/test = SQLite (`DATABASE_URL` + `SCHEMA=/tmp/…`
+ `db:migrate`), Ruby 4.0.5 v kontejneru, `libpdfium.so`, `yarn`; Postgres 18 jen jako paritní běh
`qes-test-postgres` (celá sada včetně `spec/system/dashboard_spec.rb`).

---

## 2. Střední nálezy (doladit, neblokují P0/P1, ale blokují P3/P4)

### M1 ❌ `universal_link` v § 6.1 neodpovídá § 10.1

SPEC § 6.1 vrací `universal_link: https://<host>/qes/app?token=…`, ale § 10.1 a DESIGN § 8.1 označují za
universal link `/qes/sign?token=…`; `/qes/app` je **web fallback stránka** (§ 6.4). QR kód v `QesStep` (§ 6.5) se
podle § 10.1 renderuje z universal linku → uživatel by naskenoval fallback HTML místo přímého otevření appky.

**Doporučení:** vrátit `universal_link: …/qes/sign?token=…` a přidat samostatné `fallback_url: …/qes/app?token=…`
(nebo pole přejmenovat). Sladit § 6.1, § 6.5, § 10.1 a DESIGN § 8.1.

### M2 ❌ SPEC § 10.1 stále obsahuje parametr `s=<base64 host>`

SPEC § 16 #9 výslovně říká, že parametr `s` byl odstraněn („server_url se bere z odpovědi API“), DESIGN § 8.1 má
`dokulachtan://sign?token=…`. SPEC § 10.1 tabulka je zbytková a musí se opravit (jinak by ji implementátor zavedl).

### M3 ⚠️ Stav v odpovědi `GET /qes/sessions/:token`

SPEC § 5.1 text: session přejde `awaiting_app → app_opened` a zapíše `app_opened_at`; příklad odpovědi ale vrací
`"state": "awaiting_app"`. Musí být jasné, zda odpověď hlásí stav před přechodem, nebo po něm (app se podle toho rozhoduje).

### M4 ❌ Chybí `422 not_qualified` v tabulce chyb

SPEC § 5.2 pravidlo 5 zavádí `422 not_qualified` (cert bez `QcCompliance` u `level_required = ades`), ale § 5.6
(kanonická tabulka chyb pro appku) ani příloha D (§ 21 texty) ho neuvádějí. Appka by neuměla zobrazit chybu.

### M5 ❌ Omezení „jen jeden podepisující“ nemá místo v patchi

SPEC § 4.1: šablona s `qes` polem a více podepisujícími MUSÍ selhat s `qes_single_signer_only`. Serverová validace typů polí
v Ruby neexistuje (jediná místa s výčtem typů: `app/models/submitter.rb:114`, `lib/submitters/*`), takže je potřeba nová
validace (např. `validate :qes_single_signer_only` v `app/models/template.rb`) — tabulka § 7.7/§ 14 ji neuvádí a `TemplatesController#update`
(`app/controllers/templates_controller.rb:56-63`) volá `@template.save!` → jinak by vznikla 500 místo `qes_single_signer_only`.

### M6 ⚠️ Rate limiting test v `RAILS_ENV=test` neprojde

SPEC § 5 a § 19 bod 6 vyžadují `429 rate_limited` přes `Rails.cache` bez nové závislosti. `config/environments/test.rb:30`
má `cache_store = :null_store` → počítadlo nikdy nic nezapíše, test 429 nemůže projít. Test env musí mít `:memory_store`
(nebo test rate limiting stubovat).

### M7 ❌ E2E fixture PKCS#12 nemá QCStatements → `422 not_qualified`

SPEC § 15.2 krok 3 používá „test PKCS#12 z `test/certs/`“ = `test/certs/signer.p12`, což je **self-signed cert bez
QCStatements** (level `none`). Při `preferences.level = ades` (default) ho § 5.2 pravidlo 5 odmítne (`not_qualified`).
Pro `signer-ades.crt` / `signer-qscd.crt` navíc **neexistuje `.p12`** a `--trust test/certs/signer.cert.pem` by pro ně
nestačil (jsou podepsané `test/certs/pki/root.crt`).

**Doporučení:** doplnit fixture `.p12` pro AdES (a QES) profil a v § 15.2 uvést odpovídající trust root
(`test/certs/pki/root.crt`).

### M8 ❌ `QES_EXPIRY_JOB_INTERVAL` nemá plánovač

SPEC § 11 a PLAN 1.6 počítají s periodickým `Qes::ExpireSessionsJob`. Fork nemá `sidekiq-cron` ani jiný plánovač
(`Gemfile.lock` — jen `sidekiq`; upstream plánuje jednorázově přes `perform_at`, např. `lib/submissions.rb:140`).
SPEC § 22 navíc zakazuje nové závislosti. Je nutné zvolit mechanismus: self-rescheduling job (`perform_in` na konci),
nebo líná expirace při čtení/pollingu.

### M9 ⚠️ `signature_algorithm` slibuje víc, než HexaPDF umí

SPEC § 4.2/§ 5.2/§ 5.6 uvádějí `rsa_pkcs1v15`, `rsa_pss`, `ecdsa`. HexaPDF 1.7 `SignedDataCreator` umí jen RSA
(hlavička souboru: „only RSA signatures are currently supported!“), ECDSA jen částečně. Pro v1 (node-forge
`RSASSA-PKCS1-V1_5`, MOI `RSA_SHA256_PKCS1_PADDING`) stačí `rsa_pkcs1v15`; ostatní hodnoty ze spec vypustit nebo označit
jako mimo v1 (jinak `unsupported_key` nikdy nenastane a enum je mrtvý kód).

### M10 ⚠️ AASA se nedoručí jako `application/json`

SPEC § 6.6/§ 10.2 vyžaduje `public/.well-known/apple-app-site-association` s `Content-Type: application/json`.
`ActionDispatch::Static` bere typ z přípony (`Rack::Mime`); soubor bez přípony → `application/octet-stream`.
`config.public_file_server.enabled = true` (`config/environments/production.rb:37`) jinak soubory servíruje.

**Doporučení:** přidat route/controller (nebo middleware) pro `/.well-known/apple-app-site-association`
s explicitním `Content-Type`; u `assetlinks.json` stačí statika. Doplnit do § 7.7/§ 18 (+ test).

### M11 ⚠️ Chybí úprava `Submitter#with_signature_fields?`

`app/models/submitter.rb:111-115` rozhoduje podle `%w[signature initials]`, jestli UI/e-maily mluví o „podpisu“:
`app/views/submitter_mailer/invitation_email.html.erb:8-9` („you have been invited to sign“), `submit_form/completed.html.erb:16`,
`start_form/completed.html.erb:15,22`, `submissions_preview/completed.html.erb:18`.
Šablona s pouze `qes` polem by uživateli psala „submit the form“ / „completed on time“ místo „sign“ / „signed on time“.
Tabulka § 7.7 tuto změnu neuvádí (1 řádek, vlastní commit).

### M12 ⚠️ `Qes::NotifyJob` je jen v DESIGN

DESIGN § 7.3 uvádí `Qes::NotifyJob` (e-mail/webhook po dokončení), SPEC § 7.3/§ 18/§ 14 ho nezná (notifikace řeší
standardní DocuSeal po `completed`). Rozhodnout a sladit (nejspíš z DESIGN vypustit).

### M13 ⚠️ § 13: „MUSÍ … (volitelné, § 17)“

SPEC § 13: „Session **MUSÍ** být dostupná v `GET /api/submissions/:id` (rozšíření `Submissions::SerializeForApi`
o `qes` metadata — volitelné, § 17)“. MUSÍ a volitelné si odporuje; § 17 #6 to vede jako otevřenou otázku.

### M14 ⚠️ Zastaralý skeleton a FORK.md matou P2.10

`fork/FORK.md` a `fork/app/lib/qes/provider.rb` (i zkopírovaný `vendor/docuseal/app/lib/qes/provider.rb`) uvádějí
`Qes::Providers::Pkcs11` (server-side A) a `Qes::Providers::P12`, a `level`/`key_location` jako vlastnosti providera
(metody `prepare(pdf_bytes, signer)`, `activation`, `collect`, `embed`, `validate`). To odporuje SPEC § 16 #1/#4 a `docs/04:8-9`
(„PKCS#11 neexistuje, A je client-side; provider je jen `mobile_app` + `mock`; `level`/`key_location` jsou na `QesSession`)
a dvoukrokovému protokolu § 5 (certifikát přichází až po otevření appky). PLAN 2.10 s těmito názvy metod počítá.

**Doporučení:** v P0 (nebo P2.10) skeleton přepsat (`prepare(submitter, field)` → TBS, `data_to_sign(certificate)`,
`build_cms(signature)`, `embed`, `validate`) a `FORK.md` aktualizovat.

---

## 3. Menší nálezy a upřesnění

| # | Nález | Doporučení |
|---|---|---|
| m1 | SPEC.md končí osamoceným řádkem „7. DSS / ETSI conformance checker jako noční CI job.“ (duplikát § 17 #7) | smazat |
| m2 | § 4.3 `failed` scope neobsahuje `declined`, i když tabulka přechodů `declined` zná | doplnit |
| m3 | § 4.2/§ 7.6: `signed_pdf_sha256` je hash **finálního** (opečetěného) PDF, ale § 15.2 validuje `signed_document` před pečetí; hash pre-seal artefaktu se nikde neukládá | pojmenovat/rozdělit (`signed_pdf_sha256` vs `final_pdf_sha256`) |
| m4 | § 7.7 `form.vue` „3 řádky“ — ve skutečnosti je na typ `signature` vázáno ≥ 6 míst (`form.vue:158, 650, 1151, 1157, 1222, 1715`) | v plánu uvést „projít větve na `signature`“, ne 1 řádek |
| m5 | § 7.7 `builder.vue:1176` je jen definice propu `fieldTypes` (default `[]`); skutečný seznam typů je `fieldIcons` v `field_type.vue:142` (+ `fieldNames`, `skipTypes:166`) | řádek v builder.vue vypustit (je to no-op), uvést `fieldNames` |
| m6 | § 9.3: node-forge API pro RSA je `privateKey.sign(forge.md.sha256.create().update(data_to_sign))`, ne `pki.rsa.sign` | opravit text (ověřeno v docs node-forge) |
| m7 | § 5.4: `token_expired` mapuje na `failed`, ale interní `failure_code` pro něj v § 5.6 chybí (patrně `expired`) | doplnit mapování |
| m8 | § 5.2/§ 5.3: appka musí vždy nejdřív `GET`, pak `POST /certificate` (stav `app_opened`); není řečeno, co se stane při `POST /certificate` z `awaiting_app` | doplnit (povolit implicitní `app_opened`, nebo `409`) |
| m9 | § 15.2 krok 4: `GET /api/submissions/:id/documents` bez `merge=true` vrací `documents` (per submitter), s `merge=true` vrací `merged_document` → pro QES musí být v testu `merge=false`, jinak se testuje jiný artefakt než `final_document` | doplnit přesnou URL |
| m10 | P0.4 je už hotové (`scripts/make_test_pki_crl.py:24-28,102-104`, certy v `test/certs/pki/`); P0.4 navíc zmiňuje `QcType`, který ve fixtures není | P0.4 zkrátit / ověřit |
| m11 | § 5.6 interní `failure_code` nemá `not_qualified`/`invalid_certificate`/`certificate_expired`/`unsupported_key`/`level_mismatch`/`qes_required_qscd` (to jsou HTTP chyby, ale stav session po odmítnutí certu není definován) | doplnit, zda cert-reject session `failed`, nebo zůstává `app_opened` |
| m12 | `test/certs/ica/*` nejsou v SPEC § 15 zmíněny jako trust roots pro produkční-like test | doplnit do runbooku |

---

## 4. Co je ověřené ✅ (audit nenašel problém)

- **Všechny odkazy na soubory a řádky existují**: `config/routes.rb:155`, `lib/submissions/generate_result_attachments.rb:82/85/140/215/765`,
  `generate_combined_attachment.rb:7/34/61`, `generate_audit_trail.rb:34/73`, `app/views/submissions/_value.html.erb:9`,
  `form.vue:487`, `field_type.vue:142`, `builder.vue:1176`.
- **API a třídy, o které se SPEC opírá, existují s uvedenými jmény**: `Submissions::GenerateResultAttachments` je `module_function`
  (`.generate_pdfs` je volatelné), `Accounts.load_signing_pkcs` (`lib/accounts.rb:80`), `Accounts.load_timeserver_url` (`:106`),
  `VerifyPdfSignature.call(io, trusted_certs)` (`lib/verify_pdf_signature.rb:15`), `LockEvent` s enum `complete/fail/start/retry`
  (`app/models/lock_event.rb`), `Submitters::AuthorizedForForm.call(submitter, current_user, request)` (`lib/submitters/authorized_for_form.rb:8`),
  `Submitters::SubmitValues` + `RequiredFieldError` (`lib/submitters/submit_values.rb:6,96`).
- **`app/lib/` je autoload path** — skeleton `app/lib/qes/provider.rb` je ve forku nasazený a běží, takže `Qes::*` se načte
  (Rails přidává `app/*` do autoload_paths; produkce eager-load).
- **HexaPDF API našeho plánu existuje**: `Signing.embed_signature(io, signature)` (`signing.rb:62`) a při malé rezervě vyhodí
  `HexaPDF::Error` → `signature_size_exceeded` je implementovatelné; `Signatures#add` vždy zapisuje `incremental: true`
  (`signatures.rb:139`) → pečeť neporuší podpis appky; `Document#sign(..., certificate:, key:, certificate_chain:,
  timestamp_handler:, signature_size:)` odpovídá § 7.6; `SignedDataCreator#digest_and_sign_data(data)` skutečně dostává DER `SET`
  podepsaných atributů (`signed_data_creator.rb:113,176`) → zachycení `signed_attrs_der` v § 7.2 je správné.
- **Hodnota `qes` projde standardním `SubmitValues`**: `normalize_value` pro neznámý typ vrátí hodnotu beze změny
  (`normalize_values.rb:90-107`) a `qes` není v `NON_PREFILLABLE_FIELD_TYPES` (`:18`), takže § 4.5 krok 4 funguje.
- **LTV v CMS je v ekosystému průchodné**: `docs/05:131,139` — pyHanko ukládá i validuje revokační data v CMS
  (offline `trusted=True`); `test/certs/pki/*` obsahují QCStatements (AdES i QSCD).
- **Kritérium hotovo je definované jednou větou a konzistentně** (DESIGN § 1, § 7.4; SPEC § 15.2, § 15.4) — včetně
  `signed_document` před pečetí a `final_document` po pečeti.
- **Designová rozhodnutí 1–11 z AGENTS.md odpovídají DESIGN i SPEC** (kontrolováno bod po bodu: dvoukrokový protokol,
  LTV v CMS, MOI SDK, pečeť inkrementálně, jeden podepisující, level per-field, deep link bez `s`).

---

## 5. Odpověď na otázku „je vše připraveno pro implementaci?"

**Původně ne úplně.** Všechny nálezy byly 2026-10-16 opravené (viz § 6); pořadí prací bylo:

1. **Teď (dokumentace, ~1 h):** opravit B1, B2, B3 (rozhodnutí + text), M1–M5, M9–M14, m1–m12.
2. **P0:** přepsat 0.2 a 0.5 podle reálného harness (dev/test = SQLite s `DATABASE_URL` a `SCHEMA=/tmp/…`,
   Ruby 4.0.5 v kontejneru, `libpdfium.so`, `yarn`; Postgres 18 jen jako paritní běh `qes-test-postgres`);
   0.4 je už hotové.
3. **P1:** B1, B5, M5, M8 → jinak není jasné, co má `QesSession` a `SubmitValues` dělat.
4. **P2:** B4, M9, M14 → jinak se implementace rozjede podle zastaralého skeletonu.
5. **P3:** B2, B3, M1, M6, M10, M11 → jinak vznikne 3. signatura, rozbitá stránka nebo bypass QES.
6. **P4:** m6, M7 → jinak e2e s test certem neprojde validací.
7. **P5:** beze změny — riziko nedostupnosti MOI AAR je v PLAN správně uvedené jako blokátor.

---

## 6. Stav opravy (2026-10-16) — všechny nálezy vyřešeny

| # | Nález | Oprava | Kde |
|---|---|---|---|
| B1 | token vs `410 used_token` vs idempotence | `token_digest` se **nevyhazuje** do terminálního stavu, drží se do retence; semantika tokenu (410 used/expired) je v § 5 | SPEC § 4.3, § 5 |
| B2 | dvojí pečeť → 3 signatury | pečeť se aplikuje **právě jednou** (`Qes::Seal`); `combined_document` = kopie `final_document` bez `sign_pdf`; hook v `call`, ne v `build_combined_pdf` | SPEC § 7.6, § 7.7, § 14; DESIGN § 7.4; PLAN 3.7 |
| B3 | `next` v `_value.html.erb` | předepsáno **`return`** (partial je `def`); stejně tak `form.vue` = projít větve na `signature` (6 míst) | SPEC § 7.7; PLAN 3.9 |
| B4 | `signing-time` u PAdES | podtřída **přepíše i `create_signed_attrs`** a `signing-time` vynutí; testuje `openssl cms -cmsout -print` | SPEC § 7.2; PLAN 2.4 |
| B5 | nevalidovaná hodnota `qes` pole (bypass) | `Qes::ValueValidator` + hook v `SubmitValues#validate_values!` | SPEC § 4.4, § 7.7, § 14; PLAN 3.13 |
| B6 | P0 harness (SQLite, `bundle install`) | P0.2 hotový a **změřený**: test image `test/qes/Dockerfile` (+ `Dockerfile.system` s chromium), `PRIMARY_DATABASE_URL=sqlite3:db/qes-test.sqlite3` (pozor: `DATABASE_URL=sqlite3:…` neprojde — `production:` sekce v yml je pro sqlite URL prázdná → `InvalidConfigurationError`), `SCHEMA=tmp/qes-test-schema.rb` (`db/schema.rb` zůstal čistý), `make qes-test-assets`; výsledky: SQLite 243/1 (upstream flake), Postgres 247/0 | PLAN 0.2–0.6; SPEC § 15.1, § 22; AGENTS #12; `test/qes/README.md` |
| M1 | `universal_link` na `/qes/app` | `universal_link` = `/qes/sign`, nové `fallback_url` = `/qes/app` | SPEC § 6.1, § 6.5; DESIGN § 4 |
| M2 | zbytkový parametr `s` | odstraněn z § 10.1 | SPEC § 10.1 |
| M3 | stav v odpovědi `GET` | odpověď vrací `app_opened` (stav po přechodu) | SPEC § 5.1 |
| M4 | chybí `not_qualified` | doplněno do tabulky chyb i do UX textů | SPEC § 5.6, § 21 |
| M5 | validace „jeden podepisující“ | `validate :qes_single_signer_only` v `app/models/template.rb` + hook | SPEC § 4.1, § 7.7, § 14; PLAN 3.14 |
| M6 | rate limit v test env | poznámka: test env musí mít `:memory_store` | SPEC § 5 |
| M7 | e2e fixture bez QCStatements | `test/certs/pki/signer-ades.p12` (+ `signer-qscd.p12`), trust root `test/certs/pki/root.crt` | SPEC § 15.2; PLAN 0.4, 6.1; `scripts/make_test_pki_crl.py` |
| M8 | chybějící plánovač jobů | samo-plánující smyčka `perform_in` + `LockEvent` (bez `sidekiq-cron`) | SPEC § 7.8, § 11, § 22; DESIGN § 7.3; PLAN 1.6 |
| M9 | `rsa_pss`/`ecdsa` | v1 jen `rsa_pkcs1v15` (HexaPDF 1.7 CMS umí jen RSA) | SPEC § 4.2 |
| M10 | AASA content type | `Qes::WellKnownController` s `Content-Type: application/json` | SPEC § 6.6, § 7.7, § 18; PLAN 3.12 |
| M11 | `with_signature_fields?` | `qes` přidán do `signature_field_types` | SPEC § 7.7, § 14; DESIGN § 7.1; PLAN 3.15 |
| M12 | `Qes::NotifyJob` jen v DESIGN | odstraněn z DESIGN (notifikace řeší DocuSeal) | DESIGN § 7.3 |
| M13 | „MUSÍ … (volitelné)“ | § 13 odkazuje rozšíření API jako mimo v1 (§ 17 #6) | SPEC § 13 |
| M14 | zastaralý skeleton (`Pkcs11`/`P12`) | skeleton přepsán na dvoukrokový protokol, `FORK.md` aktualizován | `fork/app/lib/qes/provider.rb`, `fork/FORK.md`, fork commit `71a0bca` |
| m1 | osamocený řádek na konci SPEC | smazán | SPEC § 22 |
| m2 | `declined` v `failed` scope | doplněno | SPEC § 4.2 |
| m3 | nejednoznačný `signed_pdf_sha256` | `signed_pdf_sha256` (před pečetí) + `final_pdf_sha256` (s pečetí) | SPEC § 4.2, § 7.6, § 13, § 19 |
| m4 | `form.vue` ≥ 6 větví na `signature` | uvedeno v hook tabulce | SPEC § 7.7; PLAN 3.10 |
| m5 | `builder.vue:1176` je no-op | řádek nahrazen `field_type.vue` (`fieldIcons`/`fieldNames`/`skipTypes`) | SPEC § 7.7, § 14; PLAN 3.11 |
| m6 | node-forge API | `privateKey.sign(forge.md.sha256.create().update(data_to_sign))` | SPEC § 9.3; PLAN 4.7 |
| m7 | `token_expired` → `failure_code` | mapováno na `expired` | SPEC § 5.4 |
| m8 | `POST /certificate` z `awaiting_app` | povoleno (server doplní `app_opened_at`) | SPEC § 5.2 |
| m9 | nejednoznačná URL v e2e | `merge=false` (a `combined_document` se testuje zvlášť) | SPEC § 15.2; PLAN 6.1 |
| m10 | P0.4 už hotové | P0.4 zkráceno na PKCS#12 fixtures | PLAN 0.4 |
| m11 | stav session po odmítnutí certu | definováno: cert-reject stav nemění | SPEC § 5.2, § 5.6 |
| m12 | trust roots pro testy | `test/certs/pki/root.crt` + `test/certs/ica/*` | SPEC § 11, § 15.2; PLAN 0.6 |

**Zbývající práce pro P0:** harness hotový a změřený (`make qes-test` = 243/1, `make qes-test-postgres` = 247/0);
`yarn`, `assets:precompile`) a Make cíle 0.5. Žádný z blokátorů už nebrání P1.
