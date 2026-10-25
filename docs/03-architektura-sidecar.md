# Nejpřímočařejší architektura: Sidecar QES pro DocuSeal

> **Překonáno:** pro produkt platí dokument [04 — Fork architektura](04-architektura-fork.md):
> když už forkueme DocuSeal, děláme všechno v něm a sidecar nepotřebujeme. Tento dokument
> zůstává jako pilotní/spike varianta bez forku.

Datum: 2026-10-14

Cíl: QES (kvalifikovaný podpis) integrovaný do DocuSealu, bez forku, s top UX:
e-mail/push → otevření → revize dokumentu → klik k podpisu → podpis uložený v dokumentu na serveru.

---

## 1. Rozdělení rolí

| Kdo | Co vlastní |
|---|---|
| **DocuSeal** | šablony, pole, příjemci, workflow, notifikace, audit trail, evidence submission |
| **QES Bridge (sidecar)** | podpisový obřad, PAdES, QTSP adaptéry, validace, signing audit, **QES PDF jako zdroj pravdy** |
| **QTSP / QSCD** | kvalifikovaný certifikát a soukromý klíč (HSM) — klíč nikdy neopustí QSCD |
| **Signer** | prohlížeč (PWA) + aplikace QTSP (I.CA) — žádná instalace, žádný klíč v telefonu |

Klíčové rozhodnutí: **podpisová stránka je naše, ne DocuSeal formulář.** Jen tak jde
udělat top UX (revize PDF, deep link do appky QTSP, stav podpisu v reálném čase).

---

## 2. Tok podpisu (krok za krokem)

Schéma je v `docs/architektura.html` (sekce „QES Bridge“). Slovně:

1. **Příprava (sender):** šablona a submission v DocuSealu jako dnes. QES pole je běžné
   `signature` pole (nebo vlastní typ, pokud patch). Submission se vytvoří s `send_email: false`
   (notifikace posílá bridge, aby měl pod kontrolou odkaz i branding).
2. **Trigger:** DocuSeal pošle webhook `submission.created` do bridge (nebo bridge sám vytvoří
   submission přes API a má ID hned).
3. **Načtení:** bridge si přes `GET /api/submissions/:id` vezme dokumenty, pole, příjemce a pozice polí.
4. **Notifikace:** bridge pošle e-mail (a volitelně SMS/push) s jednorázovým odkazem
   `https://bridge.example/s/<token>`; token je vázaný na submission + submitter + hash dokumentu, TTL 7 dní
   (otevření), signing session 5–10 min.
5. **Revize:** signer otevře mobil-first PWA, bridge vykreslí PDF (pdf.js) s překrytými poli,
   zvýrazní místo podpisu, zobrazí „co podepisujete“ (dokument, certifikát, úroveň QES).
6. **Klik k podpisu:** signer vyplní pole a klikne „Podepsat kvalifikovaným certifikátem“.
   Bridge uloží hodnoty do DocuSealu (`PUT /api/submitters/:id`, bez `completed`), připraví PAdES
   (placeholder + SHA-256 z ByteRange) a založí signing session u QTSP.
7. **Autorizace:** QTSP pošle push do své aplikace (I.CA) nebo bridge zobrazí QR/deep link.
   Signer potvrdí PIN/biometrií — podpis vzniká v QSCD, bridge vidí jen hash a CMS.
8. **Dokončení:** bridge vloží CMS + kvalifikované časové razítko + OCSP/CRL (PAdES-B-LT),
   ověří (DSS), uloží QES PDF a zapíše audit.
9. **Uzavření:** bridge dokončí submittera v DocuSealu (`PUT /api/submitters/:id` s `completed: true`
   a hodnotou podpisu jako base64 PNG pro vizuální podobu v DocuSealu). Sender i signer dostanou
   odkaz na QES PDF; v DocuSealu je submission „completed“ s auditem.

---

## 3. Co je kde uložené

| Artefakt | Kde | Poznámka |
|---|---|---|
| Šablona, pole, příjemci, workflow | DocuSeal | zdroj pravdy pro proces |
| Audit trail (kdo, kdy, co) | DocuSeal | doplněný o události bridge |
| **QES PDF (PAdES-B-LT)** | **Bridge** | zdroj pravdy pro podpis; odkaz z e-mailu |
| CMS, TSA token, validační report | Bridge | pro důkazní řízení a archivaci |
| Vizuální podpis (PNG) | DocuSeal | aby PDF v DocuSealu nebylo prázdné |
| Soukromý klíč | QSCD (QTSP/čip) | nikdy v DocuSealu ani v bridge |

---

## 4. API a webhooky, které bridge používá

| Volání | Účel |
|---|---|
| `GET /api/submissions/:id` | dokumenty, pole, příjemci, pozice |
| `GET /api/submissions/:id/documents` | PDF ke kontrole a podpisu |
| `PUT /api/submitters/:id` | hodnoty polí; `completed: true` na konci |
| `POST /api/attachments` | vizuální podpis (PNG) k submitterovi |
| webhook `submission.created` | start obřadu |
| webhook `form.viewed` / `form.started` | stav „otevřeno“ pro UX |
| webhook `form.completed` | potvrzení dokončení pro audit |
| `POST /api/submissions/emails` | volitelně resend z DocuSealu |

Poznámka: `POST /api/attachments` umí jen `type=signature|initials` a jen dokud submitter
není dokončený. Proto se QES PDF ukládá v bridge a do DocuSealu se posílá jen vizuální podpis.

---

## 5. Kde je potřeba malý patch (a kde ne)

**Bez patche (varianta „pure sidecar“):**
- QES PDF je v bridge, DocuSeal má submission completed + vizuální podpis + audit.
- Sender dostane odkaz na QES PDF z bridge (e-mail/webhook), případně ho bridge pošle
  i jako přílohu mimo DocuSeal.
- **Limit:** „combined document“ DocuSealu QES neobsahuje — je to jiný artefakt.

**S malým patchem (10–20 řádků, doporučeno pro produkt):**
- V `Submissions::GenerateResultAttachments` / `GenerateCombinedAttachment` se před generováním
  zeptá bridge (`GET /v1/submissions/:id/qes_document`); pokud existuje, použije QES PDF
  místo generovaného. Tím je QES PDF finálním dokumentem DocuSealu a audit je jeden.
- Patch držet izolovaný (`app/lib/qes/…`), licence AGPL + attribution, připravený k upstream PR
  (rozhraní `SignatureProvider`, stejně jak plánuje Documenso s CSC 2.0).

---

## 6. UX stavy (pro top UX)

| Stav | Co vidí signer | Co vidí sender |
|---|---|---|
| `sent` | e-mail/push s odkazem | „čeká na podpis“ |
| `viewed` | PDF s poli, zvýrazněné místo podpisu | „otevřeno“ |
| `reviewed` | vyplněná pole, souhrn, tlačítko Podepsat | „připraveno k podpisu“ |
| `awaiting_authorization` | „Potvrďte v aplikaci I.CA“ + QR/deep link | „čeká na potvrzení“ |
| `signed` | potvrzení + PDF ke stažení + ověření | „podepsáno QES“ + odkaz na PDF |
| `failed`/`expired` | chyba + možnost znovu | upozornění |

---

## 7. Co je potřeba dodělat (MVP backlog)

1. **Provider adaptér `ica-remotesign`** (Signi API) + `csc` (obecný) + `mock` pro testy.
2. **PAdES engine** (pyHanko): prepare → digest → embed → TSA → LTV → validace.
3. **Signing UI** (PWA): pdf.js, překrytí polí, stavový automat, deep link/QR.
4. **Token service**: jednorázové odkazy, TTL, rate limit, vazba na hash.
5. **DocuSeal klient**: webhook příjem, `GET`/`PUT` API, dokončení submittera.
6. **Audit**: append-only log, hash chain, export do DocuSealu.
7. **Testy**: e2e s testovacím certem I.CA, validace v DSS, negativní scénáře (expirace, odmítnutí, změna PDF).
8. **Dokumentace**: nasazení (docker-compose), konfigurace providerů, GDPR/DPIA.

---

## 8. Poznámky k výkonu a bezpečnosti

- **Signing session** držet krátkou (5–10 min) a jednorázovou; dlouhý TTL jen pro odkaz k otevření.
- **Hash binding**: token i session nesou SHA-256 finálního PDF; jakákoli změna PDF invaliduje session.
- **QSCD check**: bridge ověří v certifikátu `id-etsi-qcs-QcSSCD`; bez příznaku výsledek označí jako AdES.
- **Fallback**: když QTSP není dostupný, nabídnout AdES (Bank iD/MojeID) nebo podpis na později.
- **Retence**: QES PDF a validační report držet dle zákona; ostatní data minimalizovat a mazat.
- **Monitoring**: latence signing session, chybovost QTSP, čekající sessions.
