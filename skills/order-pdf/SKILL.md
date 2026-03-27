---
name: order_pdf
description: Generuoti PVM sąskaitą faktūrą arba kreditinę sąskaitą (PDF) iš WooCommerce užsakymo pagal LT reikalavimus. Naudok kai vartotojas prašo sąskaitos, invoice, kreditinės, grąžinimo, credit note, PDF arba faktūros pagal užsakymo numerį. Apima PVM paskirstymą, kainas be/su PVM. Reikia WOO_KEY ir WOO_SECRET.
metadata:
  {
    "openclaw":
      {
        "emoji": "🧾",
        "requires": { "env": ["WOO_KEY", "WOO_SECRET"] },
      },
  }
---

# order_pdf

Generuok PVM sąskaitą faktūrą (PDF) iš WooCommerce užsakymo duomenų pagal LT reikalavimus.

Sąskaita apima:
- Pardavėjo ir pirkėjo rekvizitus
- Eilučių lentelę su kaina be PVM, PVM tarifu, PVM suma ir suma su PVM
- PVM paskirstymą pagal tarifą (21%, 9%, 5%, 0%)
- Pristatymo, nuolaidos, viso PVM ir galutinę sumą
- Užrašą „Sąskaita faktūra galioja be parašo ir antspaudo"

## Naudojimas

```bash
node {baseDir}/scripts/generate-invoice.mjs <užsakymo_id>
```

Skriptas:
1. Paima užsakymo duomenis iš WooCommerce REST API (`/wc/v3/orders/{id}`)
2. Sugeneruoja PDF sąskaitą faktūrą lietuvių kalba
3. Išsaugo į `~/.openclaw/invoices/saskaita-{id}.pdf`

## Aplinkos kintamieji

- `WOO_KEY` — WooCommerce consumer key
- `WOO_SECRET` — WooCommerce consumer secret

## Pavyzdžiai

Sugeneruoti sąskaitą užsakymui #1234:

```bash
node {baseDir}/scripts/generate-invoice.mjs 1234
```

Kelios sąskaitos iš eilės:

```bash
for id in 1234 1235 1236; do node {baseDir}/scripts/generate-invoice.mjs "$id"; done
```

## Pardavėjo rekvizitai

Faile `scripts/generate-invoice.mjs` yra `SELLER` objektas — užpildyk savo įmonės duomenis:
- `companyCode` — Įmonės kodas
- `vatCode` — PVM mokėtojo kodas (pvz. LT123456789)
- `address` — Registracijos adresas
- `bank` — Bankas
- `account` — Atsiskaitomoji sąskaita

## Kreditinė sąskaita (grąžinimai)

Sugeneruoti kreditinę PVM sąskaitą faktūrą užsakymui, kuris buvo grąžintas:

```bash
node {baseDir}/scripts/generate-credit-note.mjs <užsakymo_id>
```

Kreditinė sąskaita:
- Pavadinimas: „KREDITINĖ PVM SĄSKAITA FAKTŪRA"
- Nurodo susijusios originalios sąskaitos numerį (Serija B Nr.)
- Rodo grąžinamas sumas su minuso ženklu
- PVM paskirstymas pagal tarifą
- Grąžinimo priežastis (jei nurodyta WooCommerce)
- Palaiko pilną ir dalinį grąžinimą
- Išsaugo į `~/.openclaw/invoices/kreditine-{id}.pdf`

Cron (`invoice-cron.mjs`) automatiškai generuoja kreditines sąskaitas užsakymams,
kuriems buvo išrašyta sąskaita ir kurie vėliau buvo grąžinti/atšaukti.

## Statusų validacija

- `completed`, `processing` — leidžiama generuoti sąskaitą
- `cancelled`, `refunded`, `failed` — blokuojama (naudokite `--force` arba kreditinę)
- `pending`, `on-hold` — blokuojama

## Pastabos

- PVM sąskaita faktūra pagal LT reikalavimus
- PDF naudoja A4 formatą
- Valiuta: EUR
- PVM tarifas nustatomas automatiškai iš WooCommerce mokesčių duomenų
- Palaikomi LT tarifai: 21% (standartinis), 9%, 5%, 0%
- Sąskaitos saugomos `~/.openclaw/invoices/`
- Jei katalogas neegzistuoja, bus sukurtas automatiškai
