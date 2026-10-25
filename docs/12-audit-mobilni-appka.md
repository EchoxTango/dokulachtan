# 12 — Audit mobilní appky (DESIGN § 5–6, SPEC § 9–10, § 21)

Datum: 2026-10-16
Metoda: DESIGN § 5–6 a SPEC § 9–10, § 11, § 15.3, § 20, § 21 vs. rozhodnutí uživatele.
Nálezy G1–G10 a jejich rozřešení. Rozhodnutí uživatele (2026-10-16) jsou v AGENTS #13 a #14.

**Verdikt:** appka je v DESIGN i SPEC pokrytá na úrovni, ze které se dá postavit (obrazovky S1–S10,
toky B i A, úložiště, chyby, texty, testy, struktura), ale chyběla dvě věcná rozhodnutí (G1, G2) a osm
textových/doplňkových mezer (G3–G10). Vše je opravené níže.

## 1. Věcné nálezy (rozhodnutí)

### G1 ❌ Heslo k PKCS#12 vs. biometrie → **vyřešeno: při podpisu jen biometrie**

Původně: SPEC § 9.5 („Heslo k PKCS#12 se **NESMÍ** ukládat; používá se jen v paměti při importu
**a při podpisu**“) si odporovalo s § 9.3 krok 3 a DESIGN § 5.2 („odemčení PKCS#12 AES-GCM klíčem ze
SecureStore“, „při podpisu se klíč použije v paměti a zahodí“). Když se heslo neukládá a biometrie odemyká
jen vault klíč, nemá appka při podpisu čím PKCS#12 dešifrovat.

**Rozhodnutí uživatele (2026-10-16): při podpisu se **nikdy nezadává heslo** — musí fungovat biometrie.**

**Jak je to teď (SPEC § 9.5):**
- Při importu: PKCS#12 se dešifruje heslem (jednorázově, v paměti) a **soukromý klíč + certifikát + řetěz
  se ihned znovu zašifruje** AES-256-GCM klíčem z vaultu; heslo se zahodí a soubor PKCS#12 se po importu smaže.
- Vault klíč: náhodný 256bitový v `expo-secure-store`; odemyká se biometrií před každým podpisem.
- Při podpisu: biometrie → odemčení vault klíče → dešifrování klíčového materiálu v paměti → podpis →
  vymazání (`key = null`). **Žádné zadávání hesla.**
- **Bez biometrie se nepodepisuje** (žádný fallback na heslo ani PIN appky).

### G2 ❌ Chybějící volba podepisujícího (klíč vs. čip) → **vyřešeno: automaticky dle `level_required` + wizard S10**

Původně: SPEC § 9.3 a § 9.4 popisovaly dva toky, ale nikde nebylo, jak appka pozná, kterou cestou jít
(`key_location` je jen na serveru a server cert podepisujícího předem nezná).

**Rozhodnutí uživatele (2026-10-16): volba závisí na předchozí konfiguraci appky; když není ani jedno,
spustí se konfigurační wizard. Volba je automatická (bez ptaní) podle `level_required`.**

**Jak je to teď (nová SPEC § 9.8 + obrazovka S10):**

| Stav appky | Cesta | `key_location` |
|---|---|---|
| Je importovaný klíč (PKCS#12 ve vaultu) | B (klíč v telefonu) | `phone_keystore` |
| Není klíč, ale je nastavená/spárovaná čtečka | A (čip) | `card` |
| Ani jedno | S10 wizard: „Importovat klíč“ → S2, nebo „Nastavit čtečku“ → S8 | — |

Navíc: `level_required = qes` a lokálně jen AdES klíč → appka **MUSÍ** nabídnout cestu přes čtečku
(S8/S9) nebo S10, nikdy neposílat certifikát, který server odmítne (`422 qes_required_qscd`).
Volba je **automatická podle `level_required`** (rozhodnutí uživatele 2026-10-16): pro QES vyhrává čtečka,
pro AdES klíč → čtečka → wizard; v S4 je jen vidět, který podepisující se použije (změna přes S1/S10).

## 2. Textové a doplňkové mezery

| # | Nález | Oprava | Kde |
|---|---|---|---|
| G3 | Neznámá verze `X-QES-Protocol` (§ 5.7) neměla obrazovku ani text | Přidán stav do § 9.6 + klíč `qes.app.error_protocol` | SPEC § 9.6, § 21 |
| G4 | „Dokončuji na serveru…“ + „Zkontrolovat znovu“ (202/`embedded`, § 5.3) byly jen v protokolu | Přidán stav do § 9.6 + klíče `qes.app.finishing`, `qes.app.check_again` | SPEC § 9.6, § 21 |
| G5 | `wrong_certificate` u S4 nebyl nikde definován (server cert nezná předem) | Definováno jako lokální kontrola `level_required`; přidán stav `no_signer` → S10 | SPEC § 9.1, § 9.6 |
| G6 | § 9.3 krok 4 neříkal, že appka posílá i řetěz z PKCS#12 | Doplněno („s certifikátem a **řetězem**“) | SPEC § 9.3 |
| G7 | S1/S3 zobrazovaly „expiruje“, ale nebyl definován práh ani chování | Definováno: < 30 dní, jen varování, podpis neblokuje | SPEC § 9.1 |
| G8 | S7 má ruční „server URL“ a § 5.1 vrací `server_url` — konflikt nebyl vyřešen | `server_url` z payloadu je autoritativní pro session; ruční hodnota je jen výchozí | SPEC § 10.3 |
| G9 | § 21 je jen `cs`, ale konec § 21 slibuje „v1 čeština + angličtina“ | `cs` je kanonická sada klíčů; `en` se vede se stejnými klíči v `mobile/app/src/i18n/en.ts` | SPEC § 21, PLAN 4.12 |
| G10 | iOS: § 22 „iOS až F2“, ale § 6.6 vyžaduje AASA + `QES_IOS_TEAM_ID` a § 15.4 #7 ověření i na iOS | Výslovně: v1 = Android (App Links ověřené); AASA + `QES_IOS_TEAM_ID` je příprava pro F2 | SPEC § 22, § 6.6 |

## 3. Co bylo ověřené jako pokryté ✅

- Obrazovky S1–S9 (DESIGN § 5.1, SPEC § 9.1) — obsah, akce i chybové stavy.
- Navigace a stav (SPEC § 9.2) — `expo-router`, stav jen v paměti, chování na pozadí.
- Tok B (SPEC § 9.3) — 7 kroků včetně `node-forge` API a mazání klíče.
- Tok A (SPEC § 9.4) — 7 kroků, MOI AAR, `getContainerList`, `signData` + QPIN, blokace kódu.
- Chybové stavy (SPEC § 9.6), struktura a moduly (SPEC § 9.7), deep linky (SPEC § 10), texty
  (SPEC § 21), manuální protokoly (SPEC § 20), testy (SPEC § 15.3), konfigurace (SPEC § 11),
  akceptační kritéria (SPEC § 15.4 #5–#7), rizika (PLAN 5.1–5.2).
- Mimo v1 a správně neuvedeno: push notifikace, desktop A, více certů, iOS build (SPEC § 17).

## 4. Odkazy

- DESIGN § 5.1–5.3 (obrazovky, interakce, datové toky), § 6 (varianta A), § 12 #12–13.
- SPEC § 9.1–9.8, § 10.3, § 15.3–15.4, § 16 #11–12, § 21, § 22.
- PLAN 4.4, 4.11–4.12, Checkpoint 4.
- AGENTS #13 a #14.
