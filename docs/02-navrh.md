# Návrh řešení: QES Bridge pro DocuSeal (ČR)

Datum: 2026-10-14

> **Rozhodnutí (2026-10-14):** jdeme cestou **forku DocuSealu s rozhraním `Qes::Provider`
> a variantami A (čip eObčanky → QES) a B (klíč v keystore telefonu → AdES)**; remote
> providery (I.CA RemoteSign, PostSignum, CSC) jsme vypustili. Aktuální rozhodnutí je
> v [04 — Fork architektura](04-architektura-fork.md); tento dokument zůstává jako širší
> průzkum možností a obchodní kontext.

---

## 1. Principy

1. **Klíč nikdy neopustí QSCD.** Buď zůstane v čipu karty (lokální QSCD), nebo
   v certifikovaném HSM kvalifikovaného poskytovatele (remote QSCD). Do DocuSeal ani
   do Bridge se nikdy nenahrává soukromý klíč ani PKCS#12 s kvalifikovaným certifikátem.
2. **Bridge je workflow layer, ne úložiště klíčů.** Připraví PDF, spočítá hash, zprostředkuje
   aktivaci u uživatele, vloží podpis, přidá časové razítko a LTV, ověří výsledek a zapíše audit.
3. **Nezávislost na jednom QTSP.** Vše jde přes rozhraní `SignatureProvider`, takže lze
   připojit I.CA, PostSignum, další CSC-kompatibilní QTSP i budoucí EUDI peněženku.
4. **Uživatel má výhradní kontrolu.** Každý podpis aktivuje uživatel sám (PIN, biometrie,
   potvrzení v aplikaci QTSP) a před podpisem vidí, co podepisuje.
5. **Open source a EU hosting.** Bridge je open source, běží v EU, data minimalizovaná.
6. **Úroveň podpisu je vlastnost providera a musí být viditelná.** AdES se nikdy nesmí prezentovat
   jako QES; bridge i UI nesou metadata o úrovni, certifikátu a QSCD a zapisují je do auditu.

---

## 2. Architektura

```
┌──────────────────────────────┐
│  DocuSeal (self-hosted)      │
│  - templates, recipients     │
│  - audit trail, e-mail       │
│  - final PDF assembly        │
│  - nový typ pole: QES        │
└──────────────┬───────────────┘
               │ REST API + webhooks (PUT /api/submitters/:id, form.completed)
               ▼
┌──────────────────────────────┐      ┌────────────────────────────┐
│  QES Bridge (open source)     │─────▶│  QTSP / QSCD               │
│  - session manager           │ CSC  │  I.CA RemoteSign          │
│  - PAdES engine (pyHanko/DSS) │─────▶│  PostSignum eIDAS Platform │
│  - provider adapters         │      │  (cert v HSM, klíč nikdy   │
│  - TSA + LTV + validace      │      │   neopustí QSCD)           │
│  - audit log                 │      └────────────────────────────┘
└──────────┬───────────────────┘
           │ activation (QR / deep link / push)
           ▼
┌──────────────────────────────┐
│  Uživatel                    │
│  - mobilní app QTSP (I.CA)     │
│  - nebo eObčanka + čtečka/NFC  │
│  - nebo EUDI wallet (2027)     │
└──────────────────────────────┘
```

Komponenty:

| Komponenta | Odpovědnost | Technologie |
|---|---|---|
| **DocuSeal patch/fork** | typ pole `qes`, hook na dokončení submittera, zobrazení stavu podpisu | Ruby/Rails, AGPL + attribution |
| **QES Bridge API** | sessions, activation URL, příjem CMS, embedding, validace, audit | Python (FastAPI) |
| **PAdES engine** | prepare / embed / TSA / LTV | pyHanko (MIT) nebo DSS (LGPL-2.1) |
| **Provider adapters** | CSC, I.CA/Signi, PostSignum, lokální eObčanka, testovací p12 | Python |
| **Validation** | validace podpisu, trust listy, validační report | DSS / EU DSS validátor |
| **Signing UI** | zobrazení dokumentu, QR/deep link, potvrzení | PWA (mobil-first) |
| **Audit log** | append-only záznam o podpisu | PostgreSQL + hash chain |

---

## 3. Režimy podpisu

| Režim | Kde je klíč | Aktivace | Úroveň | Kdy použít |
|---|---|---|---|---|
| **Remote QSCD (QTSP)** | HSM poskytovatele (I.CA, PostSignum) | mobilní app QTSP (PIN/biometrie) | **QES** | hlavní cesta, nejlepší UX, bez nové appky |
| **Lokální QSCD (eObčanka)** | čip karty | čtečka (desktop) / NFC (Android) | **QES** | zdarma, ale složitější UX; pro občany s eObčankou |
| **CSC-kompatibilní QTSP** | HSM poskytovatele | app poskytovatele (SAD) | **QES** | budoucnost, přenositelnost mezi QTSP |
| **AdES (Bank iD / MojeID / p12)** | SW / identita | bankovní identita | AdES | fallback a levná varianta |

---

## 4. Tok podpisu (remote QSCD)

```
DocuSeal            Bridge                 QTSP (I.CA)          Uživatel
   │                    │                        │                   │
   │ submitter completed?│                        │                   │
   │───────────────────▶ │                        │                   │
   │                    │ prepare PAdES + hash    │                   │
   │                    │ credentials/info         │                   │
   │                    │───────────────────────▶ │                   │
   │                    │ signHash + SAD          │                   │
   │                    │───────────────────────▶ │  push do appky     │
   │                    │                        │──────────────────▶ │
   │                    │                        │   PIN/biometrie    │
   │                    │◀─────────────────────── │◀────────────────── │
   │                    │ embed CMS + TSA + LTV   │                   │
   │                    │ validate (DSS)           │                   │
   │ PUT /api/submitters │                        │                   │
   │◀─────────────────── │                        │                   │
   │ audit + final PDF   │                        │                   │
```

Dvoufázový PAdES podpis:

1. **Prepare** — PDF dostane podpisové pole a placeholder `/Contents` (dostatečně velký).
2. **Digest** — spočítá se SHA-256 z ByteRange.
3. **Authorize** — uživatel potvrdí v aplikaci QTSP; QTSP podepíše hash v QSCD.
4. **Embed** — Bridge sestaví CMS SignedData (signed attributes, cert chain) a vloží jej do `/Contents`.
5. **Timestamp** — kvalifikované časové razítko (RFC 3161) → PAdES-B-T.
6. **LTV** — OCSP/CRL + DSS/VRI → PAdES-B-LT (případně B-LTA s archivním razítkem).
7. **Validate** — validační report, uložení k auditu.

Vícenásobný podpis = inkrementální update; každý další podpis obaluje předchozí (pořadí podepisujících
musí být definováno v DocuSeal).

---

## 5. API Bridge (návrh)

```
POST /v1/sessions
  { submission_id, submitter_id, document_url|document_sha256, provider, return_url }
  → { session_id, activation_url, activation_qr, expires_at, document_sha256 }

GET  /v1/sessions/{id}            → stav, podepisující, cert, validace
POST /v1/sessions/{id}/complete    → { cms, chain[], tsa }   (od providera/appky)
GET  /v1/sessions/{id}/result.pdf  → PAdES PDF
POST /v1/verify                    → validační report
POST /v1/webhooks/docuseal           → interní
```

Provider adapter:

```python
class SignatureProvider(Protocol):
    def prepare(self, pdf: bytes, signer: Signer) -> Session: ...
    def activation(self, session: Session) -> Activation: ...   # URL/QR/deep link
    def collect(self, session: Session) -> Signature: ...       # CMS + chain + TSA
    def embed(self, pdf: bytes, signature: Signature) -> bytes: ...
    def validate(self, pdf: bytes) -> Report: ...
```

Adaptéry:

| Adapter | Protokol | Úroveň | Poznámka |
|---|---|---|---|
| `csc` | CSC API v2.1 | QES (remote QSCD) | univerzální, OAuth2 + SAD |
| `ica-remotesign` | Signi API / I.CA RemoteSign | QES (remote QSCD) | nejkratší cesta k reálnému QES v ČR |
| `postsignum-eidas` | PostSignum eIDAS Platform | QES (remote QSCD) | druhá varianta, ověřit API |
| `postsignum-online` | Certifikát Online / iSignum | AdES (software klíč) | pozor, není QES; jen fallback |
| `eobcanka-local` | lokální čip (PKCS#11/NFC) | QES (čip = QSCD) | zdarma, složitější UX |
| `p12` | PKCS#12 | AdES | jen testy, nikdy QES |

---

## 6. Integrace s DocuSeal

### Varianta A — sidecar přes API + webhooky (bez forku)

- DocuSeal řeší šablony, workflow, e-maily, audit.
- Bridge se vloží jako „externí podpis“: uživatel dostane odkaz na Bridge, tam proběhne QES,
  Bridge pak zavolá `PUT /api/submitters/:id` s `completed: true` a hodnotami (podporuje
  i base64 obrázky) a přiloží podepsané PDF jako dokument submittera.
- **Výhody:** žádný fork, nasaditelné hned.
- **Nevýhody:** dva artefakty (DocuSeal PDF + QES PDF), složitější UX a audit.

### Varianta B — fork s patchem (doporučeno pro produkt)

- Nový typ pole `qes` v template builderu + preference `signature_type: qualified`.
- Hook v `ProcessSubmitterCompletionJob` / `GenerateResultAttachments`: místo obrázku podpisu
  se zavolá Bridge a vloží se CMS; finální PDF DocuSealu **už obsahuje QES**.
- `GenerateAuditTrail` rozšířit o záznam QES (cert, čas, validace).
- Licence: fork zůstává AGPL-3.0 + attribution; patch držet malý a izolovaný
  (`app/lib/qes/…`), aby šel rebasovat.

### Varianta C — upstream `SignatureProvider` API

- Navrhnout DocuSealu rozhraní pro podpisové providery (jako plánuje Documenso s CSC 2.0).
- Přínos pro upstream: self-hosted QES, které dnes nemá; pro nás: udržovaná cesta bez forku.
- Diskuse #537 ukazuje, že poptávka existuje.

---

## 7. Fáze

| Fáze | Obsah | Výstup | Odhad |
|---|---|---|---|
| **F0 spike** | pyHanko dvoufázový podpis + CSC mock; ověřit API I.CA/Signi a PostSignum | technické proof-of-concept, ceník, podmínky | 1–2 týdny |
| **F1 MVP** | Bridge (Python) + I.CA RemoteSign + PAdES-B-LT + DocuSeal patch + docker-compose + e2e test | podepsané PDF kvalifikovaným certem, validní v DSS | 4–8 týdnů |
| **F2** | druhý provider (PostSignum), multi-signer, QR/deep link UI, validace/LTV/archivace, audit | produkční pilot | 2–3 měsíce |
| **F3** | lokální eObčanka (desktop rozšíření / mobil NFC), QSeal, CSC adaptér, ověřovací služba | plnohodnotná platforma | 3–6 měsíců |
| **F4** | upstream PR, EUDI wallet, další QTSP, komunitní vydání | open-source ekosystém | průběžně |

**MVP kritéria úspěchu:**

1. Uživatel s kvalifikovaným certifikátem I.CA podepíše PDF v DocuSeal self-hosted.
2. PDF má PAdES-B-LT podpis, ověřitelný EU DSS validátorem a v Adobe Readeru.
3. Soukromý klíč nikdy není v DocuSeal ani v Bridge (kontrola v logu/sítí).
4. Audit trail obsahuje identitu, cert, čas, výsledek validace.
5. E2E test v CI s testovacím certem I.CA projde.

---

## 8. Bezpečnost a právo

- **Výhradní kontrola:** každý podpis aktivuje uživatel (PIN/biometrie) v aplikaci QTSP;
  Bridge nikdy nemá možnost podepsat bez uživatele.
- **WYSIWYS:** uživatel před aktivací vidí dokument (nebo jeho hash) a údaje o podpisu.
- **Jednorázový token:** nonce vázaný na hash + submitter, TTL 5–10 min, single-use,
  podepsaný Bridge.
- **Časová razítka a LTV:** kvalifikovaný TSA (I.CA/PostSignum), OCSP/CRL, DSS/VRI.
- **Audit:** append-only, hash chain, export do DocuSeal audit trail.
- **Retence:** dokumenty šifrované at rest, mazání po dokončení dle politiky, EU hosting.
- **GDPR:** DPA s QTSP, DPIA, minimalizace, žádné third-country přenosy.
- **Odpovědnost:** QTSP odpovídá za QSCD a certifikát; my za workflow, identifikaci uživatele
  a integritu přenosu hashe.
- **Nepředstírat QES:** pokud klíč není v QSCD, výsledek je AdES a musí se tak i prezentovat.

---

## 9. Rizika a otevřené otázky

| Riziko | Dopad | Mitigace |
|---|---|---|
| I.CA/Signi API podmínky a cena | blokuje MVP | ověřit smlouvu, SLA, cenu; paralelně PostSignum |
| CSC API v ČR není potvrzené | závislost na proprietárním API | abstrakce providerů, CSC jako cíl |
| eObčanka na mobilu jen Bluetooth čtečka + autentizace | lokální QES na mobilu nejde oficiálně | vlastní app s NFC (Android) nebo desktop čtečka; F3 |
| QSCD odpovědnost | právní riziko | používat jen kvalifikované QTSP a jejich QSCD |
| Fork DocuSealu | údržba, AGPL | malý izolovaný patch, snaha o upstream |
| Výpadek QTSP API | nedostupnost podpisu | fallback AdES/SES, retry, fronta |
| EUDI wallet 2027 | změní landscape | abstrakce providerů, CSC/TS 119 432 |

---

## 10. Doporučení

1. **Nejdřív F0/F1:** napojit existující remote signing (I.CA RemoteSign přes Signi API) a ověřit,
   že celý řetěz funguje na reálném kvalifikovaném certu. Nestavět novou aplikaci, dokud to není potřeba.
2. **Bridge psát provider-agnosticky** (CSC + adaptéry), aby se dalo přidat PostSignum i EUDI wallet.
3. **DocuSeal patch držet minimální** a připravit upstream PR s rozhraním `SignatureProvider`.
4. **Lokální eObčanku** řešit až ve F3 — buď desktop rozšíření (Web eID/T1C styl), nebo vlastní mobilní
   app s NFC; ověřit právní a technická omezení iOS.
5. **Paralelně sledovat Documenso** — jejich plán CSC 2.0 je stejná architektura; sdílet adaptéry.
