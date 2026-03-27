---
name: email-reply
description: Draft professional, friendly email responses in Lithuanian. Handles customer inquiries, business correspondence, follow-ups, and support replies.
---

# Email Reply

## Overview

Rašo profesianalus, draugiškus emailų atsakymus lietuvių kalba. Tinka klientų užklausoms, verslo korespondencijai, follow-up žinutėms, palaikymo atsakymams ir bendradarbiavimo laiškams.

**Kalba: lietuvių (lt).** Visi laiškai rašomi lietuviškai, nebent vartotojas aiškiai nurodo kitą kalbą.

**Tonas: draugiškas, bet profesionalus.** Šiltas ir žmogiškas — kaip kolega, kuris padeda, o ne robotas. Tuo pačiu dalykiškas ir aiškus. Jokio biurokratinio stiliaus, jokių tuščių frazių.

## Inputs

- **Gautas laiškas**: originalus emailas, į kurį reikia atsakyti (tekstas, citata arba kontekstas)
- **Kontekstas**: ko vartotojas nori pasiekti atsakymu (atsakyti į klausimą, patvirtinti, atmesti, paprašyti daugiau info ir t.t.)
- Jei trūksta informacijos, visada paklausti.
- Optional: tono pageidavimas (formaliau / laisviau), skubumas, papildoma kontekstinė info.

## Safety

- Niekada nesiųsti laiškų automatiškai. Visada pateikti juodraštį vartotojo peržiūrai.
- Niekada neįtraukti asmeninių duomenų (PHI), slaptažodžių, API raktų ar finansinės informacijos.
- Neišgalvoti faktų — jei nežinai atsakymo, pasiūlyti vartotojui patikslinti.
- Laiškai rašomi į `.local/email/` kaip juodraščiai.

## Capabilities

### 1. Atsakymas į klientų užklausas

- Atsakyti į produkto/paslaugos klausimus
- Pateikti informaciją aiškiai ir struktūruotai
- Pasiūlyti kitus žingsnius arba nuorodas

### 2. Verslo korespondencija

- Pasiūlymų atsakymai
- Bendradarbiavimo laiškai
- Susitikimų derinimas
- Padėkos ir patvirtinimai

### 3. Follow-up laiškai

- Priminimai be spaudimo
- Statusų atnaujinimai
- Pokalbio tęsiniai

### 4. Palaikymo atsakymai

- Techninių problemų sprendimai
- Žingsnis-po-žingsnio instrukcijos
- Eskalavimas ir nukreipimas

### 5. Atsisakymo / neigiami atsakymai

- Mandagiai atmesti pasiūlymą
- Pateikti alternatyvą kur įmanoma
- Išlaikyti gerą santykį

### 6. Šalti laiškai (Cold outreach)

- Pirmas kontaktas su potencialiu klientu/partneriu
- Trumpas, vertę parodantis pranešimas
- Aiškus CTA (call-to-action)

## Rašymo principai

### Struktūra

Kiekvienas laiškas turi aiškią struktūrą:

1. **Pasisveikinimas** — šiltas, bet ne per ilgas
2. **Kontekstas** — trumpa nuoroda į gautą laišką / situaciją (1 sakinys)
3. **Pagrindinis turinys** — atsakymas, informacija, pasiūlymas
4. **Kiti žingsniai** — ką daryti toliau, CTA
5. **Atsisveikinimas** — draugiškas, profesionalus

### Tono gairės

- Kreiptis „Jūs" (pagarbus) arba „tu" (jei kontekstas familiaresnis) — pagal situaciją
- Pirmas sakinys niekada neturi būti „Dėkojame už Jūsų laišką" ar panašūs šablonai
- Vengti: „Informuojame, kad...", „Atkreipiame dėmesį...", „Šiuo laišku norime..."
- Naudoti: natūralią kalbą, trumpus sakinius, konkrečius veiksmus
- Kiekvienas sakinys turi turėti vertę — jokių tuščių mandagumų

### Ilgis

- Trumpi atsakymai: 3-5 sakiniai (paprasti klausimai, patvirtinimai)
- Vidutiniai: 1-2 paragrafai (verslo korespondencija)
- Ilgi: 3+ paragrafai (techninės instrukcijos, detalūs pasiūlymai)
- Visada rinkti trumpesnį variantą, jei galima

### Formatavimas

- Naudoti bullet points sudėtingesnei informacijai
- Bold svarbiems datoms, skaičiams, terminams
- Vengti per daug formatavimo — tai emailas, ne dokumentas

## Execution Contract

1. Gauti originalų laišką arba kontekstą.
2. Paklausti, ko vartotojas nori pasiekti (jei neaišku).
3. Parašyti juodraštį į `.local/email/`:

```
.local/email/
  reply-<timestamp>.md    # Laiško juodraštis
  reply-<timestamp>.json  # Metadata (tema, gavėjas, tonas)
```

4. Pateikti juodraštį vartotojui peržiūrai.
5. Koreguoti pagal grįžtamąjį ryšį.
6. **Niekada nesiųsti automatiškai.**

## Output Format

### reply-\<timestamp\>.md

```markdown
**Tema:** Re: Dėl bendradarbiavimo galimybių
**Kam:** vardas@email.lt
**Tonas:** draugiškas, profesionalus

---

Sveiki, Mariau,

Ačiū, kad parašėte — labai džiaugiuosi, kad domitės bendradarbiavimu.

Mielai aptarčiau detales. Ar Jums tiktų trumpas skambutis šią savaitę, tarkim, ketvirtadienį arba penktadienį po 14:00?

Jei patogiau, galime viską aptarti ir el. paštu — kaip Jums geriau.

Geros dienos,
[Vardas]
```

### reply-\<timestamp\>.json

```json
{
  "subject": "Re: Dėl bendradarbiavimo galimybių",
  "to": "vardas@email.lt",
  "tone": "draugiškas, profesionalus",
  "type": "business_correspondence",
  "language": "lt",
  "word_count": 52,
  "cta": "Pasiūlytas skambutis ketvirtadienį/penktadienį"
}
```

## Guardrails

- **Niekada nesiųsti laiškų automatiškai.** Visada tik juodraštis.
- Niekada neįtraukti slaptažodžių, API raktų, finansinių duomenų ar PHI.
- Neišgalvoti faktų, datų ar pažadų — jei nežinai, paklausti vartotojo.
- Jei gautas laiškas yra phishing ar spam — perspėti vartotoją, nerašyti atsakymo.
- Nekeisti temos (subject line) be vartotojo sutikimo.
- Lietuvių kalba su taisyklingomis diakritinėmis (ą, č, ę, ė, į, š, ų, ū, ž).
- Tonas visada draugiškas, bet profesionalus — niekada ne per formalus, niekada ne per familiaraus.
