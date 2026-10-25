# Dokulachtan

**Podepište dokument z mobilu vlastním certifikátem. Klíč zůstane ve vašem zařízení —
na server se nikdy nenahraje.**

Dokulachtan je úprava open-source aplikace [DocuSeal](https://github.com/docusealco/docuseal)
pro podepisování českými certifikáty. Dokumenty, e-maily i záznam o podpisu zůstávají
v DocuSealu; appka se stará jen o samotný podpis.

[**Stáhnout appku**](https://dokulachtan-download.fly.dev/dokulachtan-signer.apk) ·
[DocuSeal produkce](https://dokulachtan.fly.dev/) ·
[DocuSeal staging](https://dokulachtan-staging.fly.dev/)

| Domů | Podepsat PDF | Ověřit PDF |
|:---:|:---:|:---:|
| <img src="docs/img/app-home.png" width="260" alt="Domovská obrazovka appky"> | <img src="docs/img/app-sign.png" width="260" alt="Obrazovka Podepsat PDF"> | <img src="docs/img/app-verify.png" width="260" alt="Obrazovka Ověřit PDF"> |

## Co umí

| Co | Jak |
|---|---|
| **Podepsat dokument z e-mailu** | Otevřete odkaz, zkontrolujete dokument a potvrdíte otisk. |
| **Podepsat PDF, které přišlo jinudy** | Vyberete soubor v appce, nebo ho nasdílíte z jiné aplikace. |
| **Ověřit cizí PDF** | Appka řekne, jestli je podpis platný, kdo ho udělal a jestli se soubor nezměnil. |
| **Vše zůstane v DocuSealu** | Podepsaný dokument, historie i audit jsou na jednom místě. |

## Jak to funguje

1. Přijde vám e-mail s odkazem na dokument.
2. Otevřete odkaz a dokument si prohlédnete.
3. Klepnete na „Podepsat“ a potvrdíte otiskem prstu nebo PINem.
4. Hotovo — dokument je podepsaný a uložený, firma vidí stav.

Pro firmu se nic nemění: dokument nahraje do DocuSealu jako dnes, vybere, kdo má podepsat,
a sleduje stav. Nic dalšího se nezakládá.

| Co | Kde |
|---|---|
| Dokument, e-mail, historie, audit | DocuSeal |
| Podpis (AdES) | appka v telefonu |
| Podpis (QES) | čip občanky přes čtečku |
| Klíč | telefon nebo čip občanky — nikdy na serveru |

## Dvě úrovně podpisu

| | AdES | QES |
|---|---|---|
| **Kde je klíč** | v telefonu | v čipu občanky |
| **Co potřebujete** | telefon | telefon a čtečku |
| **Co podpis umí** | průkazný podpis, ověřitelný v běžných nástrojích | má stejnou váhu jako vlastnoruční podpis |
| **Kdy** | pro většinu dokumentů | když to vyžaduje zákon nebo úřad |

Za podpis se neplatí. U QES potřebujete čtečku a kvalifikovaný certifikát.

## Vyzkoušet

**Podepisujete dokument?**

1. Otevřete odkaz z e-mailu.
2. Zkontrolujte dokument a klepněte na „Podepsat“.
3. Potvrďte otisk prstu nebo PIN.

**Chcete to provozovat?**

1. Nasaďte DocuSeal podle [návodu](docs/09-deployment-flyio.md).
2. Stáhněte appku (Android 7.0+) a v *Nastavení* zadejte Server URL a API token
   (DocuSeal → Nastavení → API).
3. V DocuSealu nahrajte PDF, přidejte pole „Podpis certifikátem“ a odešlete.

Testovací APK je určené pro vyzkoušení, ne pro ostrý podpis.

## Stav

- **Hotové:** podpis certifikátem v DocuSealu, Android appka (AdES i QES s testovacím čipem),
  přímý podpis PDF, ověření PDF, vícenásobné podpisy, produkce i staging.
- **Zbývá:** první reálný podpis na produkci, reálná čtečka eObčanky a kvalifikované časové razítko.
- Detail a historie: [AGENTS.md](AGENTS.md#stav).

## Pro vývojáře

Vývoj, testy, nasazení a mapa dokumentace: [DEVELOPMENT.md](DEVELOPMENT.md).

- [DESIGN.md](DESIGN.md) — co a proč
- [SPEC.md](SPEC.md) — jak přesně (model, API, obrazovky, testy)
- [PLAN.md](PLAN.md) — fáze P0–P8
- [AGENTS.md](AGENTS.md) — pravidla repa a aktuální stav

## Licence

Fork vychází z [DocuSeal](https://github.com/docusealco/docuseal) (AGPL-3.0) a zůstává
AGPL-3.0 s uvedením autorství. Vlastní kód forku: <https://github.com/v1b3coder/docuseal>.
