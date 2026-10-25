# dokulachtan

Kvalifikovaný elektronický podpis (QES) pro [DocuSeal](https://github.com/docusealco/docuseal) v ČR —
průzkum existujícího landscape a návrh otevřeného řešení.

**Problém:** DocuSeal umí QES jen v cloudu přes partnerské QTSP. Self-hosted verze QES nepodporuje
a nemá rozhraní pro čipové karty ani remote signing providery. Soukromý klíč přitom nesmí opustit
QSCD (čip karty nebo certifikovaný HSM poskytovatele).

## Dokumenty

- [DESIGN.md](DESIGN.md) — **závazný koncept (co a proč)**: aplikační design celého workflow a podpisové appky
  (model, stavy, interakce).
- [SPEC.md](SPEC.md) — **detailní specifikace odvozená z DESIGN.md (jak přesně)**: datový model, API, protokol
  server ↔ appka, obrazovky S1–S9, kryptografická pipeline, testy a akceptační kritéria.
- [PLAN.md](PLAN.md) — implementační plán: fáze P0–P6 s kroky, verifikací a checkpointy.
- [01 — Průzkum landscape](docs/01-pruzkum.md): české eID, remote signing, open-source platformy,
  standardy, komerční QES služby a mezera na trhu.
- [02 — Návrh řešení](docs/02-navrh.md): architektura QES Bridge, toky podpisu, API, integrace
  s DocuSeal, fáze, bezpečnost a rizika.
- [03 — Sidecar architektura](docs/03-architektura-sidecar.md): nejpřímočařejší varianta bez forku
  (DocuSeal workflow + bridge signing stránka, QES PDF jako zdroj pravdy). **Překonáno dokumentem 04.**
- [04 — Fork architektura](docs/04-architektura-fork.md): rozhodnutí — vše v DocuSealu
  (fork s moduly `Qes::Providers`, HexaPDF async external signing, žádný sidecar).
- [05 — E2E testování](docs/05-e2e-testovani.md): demo certifikáty, CLI validátory
  (pdfsig, pyHanko, DSS, ETSI), testovací matice a důkaz z tohoto repa.
- [06 — Design lidsky](docs/06-design-lidsky.md): co stavíme bez odborných termínů.
- [07 — Před implementací](docs/07-pred-implementaci.md): checklist rozhodnutí (Expo, fork, provoz).
- [08 — Fork workflow](docs/08-fork-workflow.md): větev `dokulachtan`, pravidla patche a rebase.
- [09 — Deployment na Fly.io](docs/09-deployment-flyio.md): analýza nasazení jako Docker kontejneru (staging).
- [10 — QES runbook](docs/10-qes.md): provoz QES (ENV, TSA, trust roots, troubleshooting).
- [11 — Audit DESIGN a SPEC](docs/11-audit-design-spec.md): nálezy z auditu připravenosti (B1–B6) a jejich oprava.
- [12 — Audit mobilní appky](docs/12-audit-mobilni-appka.md): nálezy G1–G10 a rozhodnutí k appce (biometrie, wizard S10).

## Nástroje a testy

```bash
make venv        # .venv s pyHanko + podman-compose
make fixtures    # test cert + PDF fixtures (PAdES-BES, PAdES-B-T, detached CMS)
make validate    # qpdf + pdfsig + pyHanko + openssl → test/out/report.txt
make negative    # expirace/revokace/tamper/QSCD → test/out/negative-report.txt
make verify      # fixtures + validate + negative
make e2e         # DocuSeal stack + API flow + validace → test/out/e2e-report.txt
make mobile-poc  # Android PoC: telefon podepíše digest, server vloží PAdES → test/out/mobile-report.txt
make qes-test     # RSpec forku na SQLite (celá sada kromě dashboard specu)
make qes-test-qes # jen QES vrstva (rychlá smyčka)
make qes-test-postgres # paritní běh celé sady na Postgresu 18
make qes-e2e      # fork + podpis KÓDEM APPKY → validované PDF (test/out/qes-e2e-report.txt)
make qes-app-test # Jest testy appky (vault, P12, signer, API)
make fork-setup       # klon forku + větev dokulachtan (pin = HEAD forku)
make docuseal-up      # DocuSeal přes podman-compose → http://localhost:3000
make e2e-down         # zastavit DocuSeal stack
```

## Stručně

1. **Rozhodnutí:** fork DocuSeal s moduly `Qes::Providers`, jen self-custody varianty
   **A** (čip eObčanky → QES) a **B** (klíč v keystore telefonu → AdES). Žádný remote QTSP, žádný sidecar.
2. **Potvrzené produktové odpovědi (2026-10-14):** většinou **AdES**, hlavně **mobil**,
   podepisují **zaměstnanci firmy**, výsledek **jen v DocuSealu** → hlavní cesta je **B**,
   **A** je doplňková pro QES.
3. **Plán P0–P6** ([PLAN.md](PLAN.md)): P0 příprava a harness, P1 model a stavy, P2 kryptografie,
   P3 API a integrace (hlavní důkaz řetězu), P4 Expo appka **B** (hlavní produktová cesta),
   P5 Expo appka **A** (eObčanka přes MOI Podpisové SDK), P6 e2e, staging a dokumentace.
   Rozsah v1: varianty **A i B**, pečeť DocuSealu inkrementálně, bez vzhledu podpisu, universal links.

## Stav

- [x] Discovery: průzkum landscape, rozhodnutí (varianty A+B, fork bez sidecaru)
- [x] Verifikace: e2e toolchain (pyHanko/pdfsig/qpdf) + **baseline e2e proti nezměněnému upstream DocuSealu**
      (`make e2e`, API flow + validace) + **negativní/LTV scénáře** (`make negative`: expirace,
      revokace, tamper, QSCD flag) + **mobile PoC** (`make mobile-poc`: telefon podepíše digest,
      server vloží PAdES, validováno pyHanko + pdfsig) — **kód DocuSealu zatím nijak neupraven**
- [x] Rozhodnutí: varianta **B (mobil, AdES)** první; mobilní appka **Expo**; fork ve větvi
      `dokulachtan` (clean rebaseable, `scripts/fork-setup.sh`)
- [x] QES vrstva: `qes` pole + `Qes::Providers::MobileApp` + hook v generování PDF (hotovo)
- [x] Staging deployment na Fly.io (varianta A): <https://dokulachtan.fly.dev/>
- [x] Specifikace a plán: [SPEC.md](SPEC.md), [PLAN.md](PLAN.md) (potvrzeno 2026-10-15)
- [ ] P0–P6 dle [PLAN.md](PLAN.md) (nezačato)
- [ ] F4: upstream PR

> Poznámka: `vendor/docuseal` je lokální klon forku (gitignored, pin = HEAD forku v `vendor/docuseal.rev`);
> běžící e2e používá upstream image `docuseal/docuseal:latest`, ne lokální build.
