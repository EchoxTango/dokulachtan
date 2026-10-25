# E2E testování: čím ověříme, že jsme kompatibilní s ekosystémem

Datum: 2026-10-14

> **Historický dokument.** Zachycuje ověření před implementací forku. Nástroje baseline e2e
> (`scripts/e2e.sh`, `scripts/e2e_api.py`, `test/e2e/`) a Android PoC (`scripts/mobile_poc.py`)
> byly 2026-10-25 odstraněny; nahradily je `make qes-e2e*` a `make qes-test-qes`.
> Aktuální testovací smyčka je v [DEVELOPMENT.md](../DEVELOPMENT.md).

Cíl: mít garanci, že to, co **konzumujeme** (cizí podepsaná PDF) i co **produkujeme**
(naše PAdES/QES), je kompatibilní s ekosystémem — a mít to reprodukovatelně v repu.

## 1. TL;DR

- **Demo certifikáty existují** (I.CA testovací služby, PostSignum testovací certifikát,
  HexaPDF demo cert, DSS test PKI) — viz tabulka níže.
- **Hotové CLI nástroje existují**: `pdfsig` (Poppler), `pyHanko` (sign i validate),
  `qpdf`, `openssl cms/ts`, DSS (Java), ETSI CTI conformance checker, veraPDF.
- **Toolchain je v repu připravený a ověřený** — viz „Důkaz z tohoto repa“ níže:
  fixtures se podepíšou, `pdfsig` i `pyHanko` je označí jako INTACT/TRUSTED/UNTOUCHED.
- **Fork DocuSealu je naklonovaný** v `vendor/docuseal` (pin = HEAD forku v `vendor/docuseal.rev`).

## 2. Demo certifikáty

| Zdroj | Co to je | K čemu v testech | Odkaz |
|---|---|---|---|
| **Self-signed** (`scripts/make_test_pki.sh`) | vygenerovaný cert + PKCS#12 (heslo `test`) | pipeline: B-B/B-T, detached CMS, negativní testy | tento repo |
| **I.CA testovací služby** | bezplatné testovací certifikáty I.CA | QSCD-like cesty, B-LT/OCSP/CRL, test TSA | <https://www.ica.cz/testovani-sluzeb> |
| **I.CA test TSA** | testovací kvalifikované časové razítko | PAdES-B-T/LT s reálným TSA | <https://www.ica.cz/testovani-tsa-postup> |
| **PostSignum testovací certifikát** | testovací cert (RSA/ECDSA) přes iSignum | test PostSignum cesty, ověření na test webu | <https://www.postsignum.cz/testovaci_certifikat.html> |
| **HexaPDF demo cert** | demo cert v gemu (`HexaPDF.demo_cert`) | testy v Ruby (DocuSeal používá HexaPDF) | gem `hexapdf` |
| **DSS test PKI** | testovací certy v `dss-cookbook` | testy DSS (Java, EU reference) | <https://github.com/esig/dss> |
| **ETSI TS 119 144-2** | PAdES test suites (testovací PDF) | konformita PAdES (pozitivní i negativní případy) | ETSI |

Poznámka: testovací certifikáty **nejsou** kvalifikované a **nejsou QSCD** — slouží jen
k testům technických vlastností; produkční QES se testuje s I.CA/PostSignum test certy, které
mají odpovídající profily a revocation info.

## 3. CLI a validační nástroje

| Nástroj | Co ověří | Poznámka |
|---|---|---|
| **`qpdf --check`** | struktura PDF, chyby syntaxe | v repu, rychlé |
| **`pdfsig`** (Poppler) | platnost podpisu, Signed Ranges, hash, typ | `pdfsig file.pdf` |
| **`pyhanko sign validate --trust`** | INTACT/TRUSTED/UNTOUCHED, LTV, časová razítka | hlavní validátor, Python |
| **`pyhanko sign addsig`** | produkce PAdES (B-B/B-T/B-LT/B-LTA) i detached CMS | náš referenční signer |
| **`openssl cms -cmsout -print`** | CMS SignedData: contentType, messageDigest, signingTime | detached CMS |
| **`openssl pkcs7 -print_certs`** | řetěz certifikátů v CMS | kontrola chainu |
| **`openssl ts -verify`** | TSA token (RFC 3161) | s `-token_in -data` |
| **DSS** (Java, LGPL-2.1) | validace AdES/QES dle ETSI, validační report | `dss-cookbook`, `dss-demo-webapp` |
| **DSS validation webapp** (EU) | referenční validace online | <https://ec.europa.eu/digital-building-blocks/DSS/webapp-demo/validation> |
| **EU DSS REST API** (demo) | PAdES/CAdES/XAdES, integrita, trust, revokace, timestampy | `make qes-eu-dss-verify`; test certy = untrusted, `TRUSTED=1` pro reálné; PDF opouští stroj |
| **ETSI CTI conformance checker** | konformita AdES (CAdES/XAdES/PAdES/ASiC) | <https://portal.etsi.org/TB-SiteMap/esi/esi-activities> |
| **veraPDF** | PDF/A (pokud produkujeme PDF/A) | CLI |
| **Adobe Acrobat Reader** | PAdES/LTV z pohledu koncového uživatele | ruční kontrola |
| **LOTL / trust list browser** | trust anchors (EU, ČR) | <https://eidas.ec.europa.eu/efda/trust-services/browse/eidas/tls/tl/CZ/tsp/1> |

## 4. Testovací matice

| # | Směr | Co testujeme | Čím | Kritérium |
|---|---|---|---|---|
| T1 | produce | PAdES-B-B | pdfsig, pyHanko validate | INTACT, TRUSTED, UNTOUCHED |
| T2 | produce | PAdES-B-T | pyHanko validate, openssl ts | podpis INTACT, token INTACT |
| T3 | produce | PAdES-B-LT/LTA | pyHanko validate, DSS | LTV data v PDF, podpis INTACT |
| T4 | produce | detached CMS | openssl cms -cmsout -print | contentType, messageDigest, signingTime |
| T5 | consume | cizí PDF (I.CA, PostSignum, eObčanka) | pyHanko validate, pdfsig, DSS | INTACT, TRUSTED, žádné UNTOUCHED |
| T6 | consume | cizí AdES/QES s LTV | pyHanko validate, DSS | validace i po expiraci certu |
| T7 | interop | naše PDF v ETSI/DSS/Adobe | ETSI CTI, DSS webapp, Reader | konformní, bez chyb |
| T8 | negativní | změna PDF po podpisu | pyHanko validate | UNTOUCHED / INVALID |
| T9 | negativní | expirovaný/revokovaný cert | pyHanko validate | EXPIRED / REVOKED |
| T10 | bezpečnost | klíč mimo QSCD / bez příznaku | kontrola QCStatements | AdES, nikdy QES |
| T11 | e2e | DocuSeal + fork + QES | API + webhook + fixture | podpis v finálním PDF, audit |

## 5. Důkaz z tohoto repa (spuštěno 2026-10-14)

```
$ ./scripts/make_fixtures.sh
$ ./scripts/validate.sh

# pdfsig test/fixtures/signed-pades-t.pdf
Signature Field Name: Sig1
Signer Certificate Common Name: Test Signer
Signing Hash Algorithm: SHA-256
Signature Type: ETSI.CAdES.detached
Signed Ranges: [0 - 1114], [19728 - 20439]
Total document signed
Signature Validation: Signature is Valid.

# pyhanko sign validate --trust test/certs/signer.cert.pem test/fixtures/signed-pades-t.pdf
Sig1:2947...:INTACT:TRUSTED,TIMESTAMP_TOKEN<INTACT:UNTRUSTED>,UNTOUCHED

# openssl cms -cmsout -inform DER -in test/fixtures/sig-detached.der -print
  contentType: pkcs7-signedData
  object: contentType (1.2.840.113549.1.9.3)
  object: signingTime (1.2.840.113549.1.9.5)
  object: messageDigest (1.2.840.113549.1.9.4)
  algorithm: sha256WithRSAEncryption
```

Poznámky k důkazu:

- Podpis je **INTACT** a **TRUSTED** (test root v trust listu), dokument **UNTOUCHED**.
- **TIMESTAMP_TOKEN<INTACT:UNTRUSTED>** je očekávané: časové razítko je z FreeTSA a jeho root
  v trust listu nemáme. Pro „zelené“ razítko přidat FreeTSA root nebo použít I.CA test TSA.
- **B-LT/B-LTA** se self-signed certem selže (chybí OCSP/CRL) — proto se pro LTV testy používají
  I.CA test certifikáty s test OCSP/CRL (T3/T6).

### 5.1 DocuSeal API e2e (spuštěno 2026-10-14, historicky)

```
$ make e2e

POST /api/submissions (template 1) -> HTTP 200
submission_id: 1, completed_at: 2026-10-14T16:45:22Z
GET /api/submissions/1/documents -> HTTP 200
Dokument: e2e-document-0.pdf (9846 B)

pdfsig: Signature #1, Signature Field Name: Signature1,
        Signature Type: adbe.pkcs7.detached, Total document signed
pyhanko: Signature1:...:INTACT:UNTRUSTED,UNTOUCHED
```

- **DocuSeal seal** (autogenerovaný účetní cert) je v PDF a dokument je **UNTOUCHED**.
- UNTRUSTED je očekávané — cert DocuSealu není v našem trust listu (přidat root pro „zelené“).
- **OSS limity:** `POST /api/submissions/pdf` a `/api/templates/pdf` jsou Pro; v OSS se šablona
  vytváří v UI (v e2e přes `rails runner`) a submission přes `POST /api/submissions` s `completed: true`
  a base64 PNG podpisem (`PUT /api/submitters/:id`).
- Tohle je přesně cesta, kterou použije bridge: dokončení submittera přes API + vlastní QES PDF.

### 5.2 Negativní a LTV scénáře (spuštěno 2026-10-14)

Lokální testovací PKI (`scripts/make_test_pki_crl.py`) generuje root CA s CRL Distribution Pointem,
signery s QCStatements a CRL (prázdný/revokovaný). `make negative` spustí `scripts/negative_tests.py`:

| Test | Scénář | Výsledek |
|---|---|---|
| T3 | PAdES-B-LT s LTV | `intact=True valid=True trusted=True`; **offline validace bez fetch: trusted=True** → LTV OK |
| T8 | přepis byte v podepsaném obsahu | `intact=False` → tamper detekován |
| T9a | expirovaný certifikát | `trusted=False`, `indic=OUT_OF_BOUNDS_NO_POE` |
| T9b | revokovaný certifikát (CRL) | `revoked=True`, `trusted=False` |
| T10 | QCStatements | `QcCompliance` → AdES; `QcCompliance+QcSSCD` → **QES-capable** |

Poznámky:

- pyHanko ukládá revokační data PAdES-B-LT **do CMS** (ne do `/DSS`), proto je offline validace
  klíčový test LTV (DSS dict: NE).
- QCStatements OID: `0.4.0.1862.1.1` (QcCompliance), `0.4.0.1862.1.4` (QcSSCD) — přesně tohle
  musí bridge kontrolovat, aby AdES nevydával za QES.
- pyHanko má i `QualificationAssessor` (ETSI TS 119 172-4) a `--eutl` pro trust z EU trusted listů.

### 5.3 Externí validátory a jak je získat

| Validátor | Stav | Postup |
|---|---|---|
| **ETSI Signature Conformance Checker** | online, zdarma | registrace na <https://signatures-conformance-checker.etsi.org/>; nahrát PAdES; manuální krok |
| **DSS demo webapp (EU)** | hostovaný REST vrací 403 | lokální build: `podman build -t dss-demo vendor/dss-demonstrations` (Dockerfile v repu esig/dss-demonstrations, Maven build) |
| **DSS demo (Nowina)** | <https://dss.nowina.lu> | veřejná instance pro ruční validaci |
| **pdfsig (Poppler)** | lokálně | `pdfsig file.pdf` — nezávislý C++ validátor |
| **Adobe Acrobat Reader** | lokálně | finální end-user kontrola PAdES/LTV |
| **I.CA testovací služby** | zdarma | testovací kvalifikovaný cert: <https://tests.ica.cz/cgi-bin/zadosti/RequestQPECZ.cgi>; zneplatnění: <https://testq.ica.cz/cgi-bin/revoke_qpub.cgi>; test TSA: žádost na `tsa@ica.cz` (auth heslem/IP/test certem, zdarma 1 měsíc); test roots v `test/certs/ica/` (aktuální `100001057.pem` = I.CA Test EU Qualified CA2/RSA 04/2022, platný do 2032) |
| **PostSignum test cert** | zdarma | žádost v iSignum: <https://www.postsignum.cz/testovaci_certifikat.html> |

Pro produkční důvěru validovat s `--trust <I.CA test root>` (testovací certy) nebo s `--eutl`
(trust z EU trusted listů); nikdy netrustovat „vše“.

### 5.4 Mobile PoC (varianta B) — spuštěno 2026-10-15 (historicky, nástroj odstraněn)

Ověřeno na skutečném Android emulátoru (Android 15, x86_64, AVD `qes_poc`). Dnes stejný tok
ověřuje `make qes-e2e` kódem appky (`mobile/app/src/lib`); `make mobile-poc` už neexistuje.

```
$ # historicky: make mobile-poc (dnes make qes-e2e)
1. TBS PDF: mobile-tbs.pdf, digest (SHA-256 ByteRange): 4f3a...
2. Android app (telefon): OK alias=... subject=CN=Test Signer,O=Dokulachtan Test,C=CZ
   digestInfoBytes=51 signatureBytes=256
3. Raw signatura z telefonu: signature.bin (256 B)
4. CMS sestaveno a vloženo: mobile-signed.pdf
5. pyHanko validace: intact=True valid=True trusted=True coverage=ENTIRE_FILE
   pdfsig: Signature Validation: Signature is Valid.
```

Co to dokazuje:

- **klíč zůstal v telefonu** — app načetl PKCS#12 z vlastního úložiště a podepsal jen
  DigestInfo (51 B) přes `NONEwithRSA`; server viděl pouze DigestInfo a raw signaturu.
- **výsledek je platný PAdES** — pyHanko i pdfsig (nezávislý C++ validátor) označily podpis
  za platný a celý dokument za podepsaný.
- **dvousetup je reálný**: telefon podepisuje *podepsané atributy* CMS, server skládá CMS a vkládá
  do PDF (přesně tak bude fungovat bridge pro variantu B).

Poznámky z provozu:

- App nemůže číst `/data/local/tmp` (SELinux/EACCES); soubory se předávají přes
  `run-as <pkg> sh -c 'cat /data/local/tmp/... > files/...'`.
- APK se staví cached Gradle 8.14.3 + AGP 8.10.1, bez AndroidX (žádné závislosti).
- `pyHanko` interrupted signing: `PdfSigner.async_digest_doc_for_signing` → `PdfTBSDocument.finish_signing`.
- Klíč z iSignum exportovaný jako PKCS#12 se v telefonu použije stejně (test použil PKCS#12 fixture).

### 5.5 Český testovací certifikát bez emailu?

**Ano, self-service:**

- **I.CA testovací kvalifikovaný cert** — online průvodce
  `https://tests.ica.cz/cgi-bin/zadosti/RequestQPECZ.cgi` (5 kroků: test systému → zadání údajů →
  kontrola → uložení → dokončení); klíč generuje lokální aplikace **I.CA PKI Service Host**
  (Win `icapkiservicehost_0.exe`, macOS `icapkiservicehost_mac_0.zip`) — žádný email.
- **Test CA má veřejné OCSP/CRL**: CRL `http://tests.ica.cz/trca22_rsa.crl`,
  OCSP `http://tocsp.ica.cz/trca22_rsa`, CA Issuers `http://tests.ica.cz/trca22_rsa.cer`;
  zneplatnění přes `https://testq.ica.cz/cgi-bin/revoke_qpub.cgi`. Tedy i revokace/LTV se dá
  otestovat s reálným českým test certem.
- **PostSignum testovací cert** — online formulář `https://www.postsignum.cz/testovaci_certifikat.html`
  + žádost z iSignum (RSA/ECDSA), self-service.
- **Jediné, co email potřebuje**, je I.CA **test TSA** (`tsa@ica.cz`); TSA je ale ortogonální —
  lze použít FreeTSA nebo vlastní lokální TSA.

### 5.6 Simulace vlastním stackem — co doplnit pro „ekvivalentní parametry“

Naše PKI už umí: root CA, QCStatements (QcCompliance/QcSSCD), CRL DP, revokaci, expiraci,
tamper, offline LTV. Pro ekvivalenci s českým kvalifikovaným certem doplnit:

- certificate policies: `id-etsi-qcp-n-qscd` = `0.4.0.194112.1.2`,
- QCStatements: QcType (`0.4.0.1862.1.6` = eSign), QcRetentionPeriod (`0.4.0.1862.1.3`),
  QcPDS (`0.4.0.1862.1.5`),
- OCSP responder (`openssl ocsp -port`),
- lokální TSA (RFC 3161).

**Co simulovat nelze:** členství v EU trusted listu (LOTL) a certifikovaný QSCD. Validátor proto vždy
řekne UNTRUSTED, dokud root explicitně netrustujeme — což ale platí i pro I.CA test cert (jeho test root
v LOTL není). Pro technický e2e jsou obě cesty rovnocenné; I.CA test cert navíc ověří reálný český profil
a reálné CRL/OCSP endpointy.

**Doporučení:** pro CI a každodenní testy stačí náš stack (rozšířený o policies/OCSP/TSA);
I.CA test cert vzít jednou pro potvrzení „české reality“.

## 6. Co je v repu

```
scripts/make_test_pki.sh     # self-signed cert + PKCS#12 (heslo: test)
scripts/make_test_pdf.py      # minimální jednostránkové PDF
scripts/make_fixtures.sh     # PAdES-BES, PAdES-B-T, detached CMS
scripts/validate.sh          # qpdf + pdfsig + pyHanko + openssl → test/out/report.txt
scripts/qes_e2e.py           # fork + podpis kódem appky → test/out/qes-e2e-report.txt
test/certs/                  # signer.{key.pem,cert.pem,p12}
test/fixtures/               # input.pdf, signed-pades-bes.pdf, signed-pades-t.pdf, sig-detached.der
test/out/                    # reporty a podepsaná PDF (důkazy)
vendor/docuseal/             # klon forku DocuSealu (pin = HEAD forku, gitignored)
vendor/docuseal.rev          # pinovaný commit forku (HEAD)
```

## 7. Jak spustit celý e2e

```bash
# 1. nástroje
make venv

# 2. fixtures a validace signeru
make fixtures && make validate

# 3. celý e2e: fork + podpis kódem appky + validace
make qes-e2e

# 4. DocuSeal fork ručně přes podman
make docuseal-up   # → http://localhost:3000
```

## 8. CI

- `make fixtures` + `make validate` na každý commit (rychlý, bez sítě — TSA vypnout nebo mock).
- `make qes-e2e` v separátním jobu (fork + podpis kódem appky).
- S TSA: oddělený job s `TSA_URL` (I.CA test TSA) a timeoutem.
- Matice: `pdfsig` + `pyhanko` + `qpdf` jako povinné; DSS/ETSI/Adobe jako noční job.
- **EU DSS API** (`make qes-eu-dss-verify`) je volitelný nezávislý compliance check
  vygenerovaných PDF: PAdES formát, pečeť, DocTS, integrita a plné pokrytí. Testovací
  certy nejsou v EU trusted listu, proto se trust ve výchozím režimu nekontroluje;
  `TRUSTED=1` je pro reálný cert. PDF se posílá na servery EK, proto jen testovací data.
- Fixtures (i test certy) verzované v repu → reprodukovatelnost a regresní testy.

## 9. Limity a další kroky

- **I.CA testovací služby**: postup zjištěn (formuláře výše), stačí vyřídit test cert + test TSA.
- **PostSignum testovací certifikát**: vygenerovat v iSignum (RSA/ECDSA) a otestovat.
- **DSS**: lokální build (`podman build` z `esig/dss-demonstrations`) nebo EU/Nowina webapp pro křížovou validaci.
- **ETSI CTI**: registrace + manuální upload našich PDF do conformance checkeru.
- **DocuSeal fork**: doplnit `Qes::Provider` a hook; pak e2e test „submission → QES PDF → audit“
  (dnes e2e ověřuje baseline: submission přes API + seal + validace).
