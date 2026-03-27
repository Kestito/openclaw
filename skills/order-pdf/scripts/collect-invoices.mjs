#!/usr/bin/env node

// Collect purchase invoices (sąskaitos) from Gmail by month,
// download PDF attachments, extract invoice data from PDFs,
// generate i.SAF XML, and email the result.
//
// Usage: node collect-invoices.mjs <YYYY-MM> [--send]
//   e.g.: node collect-invoices.mjs 2026-01 --send
//
// Requires env: EMAIL_ADDRESS, EMAIL_PASSWORD, IMAP_SERVER
// Optional env: SEND_TO_EMAIL (defaults to kestutis.bajorunas@gmail.com)

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import Imap from 'imap'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse')

// ── Company config ───────────────────────────────────────────────────

const COMPANY = {
  name: 'MB Bajora',
  registrationNumber: '303236293',
  vatCode: 'LT100014310611',
}

// ── Known suppliers database ─────────────────────────────────────────
// Maps email domains/addresses to supplier details from VMI records.

const KNOWN_SUPPLIERS = [
  {
    match: ['tele2.lt'],
    name: 'UAB "TELE2"',
    vatNumber: 'LT11471641',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['post.lt', 'lietuvos pastas', 'lietuvos paštas'],
    name: 'Akcinė bendrovė Lietuvos paštas',
    vatNumber: 'LT212155811',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['ltbaldai', 'lt baldai'],
    name: 'UAB "LT baldai"',
    vatNumber: 'LT100001603516',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['open24', 'open 24'],
    name: 'UAB "Open 24"',
    vatNumber: 'LT100002476918',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['skilsas'],
    name: 'MB SKILSAS',
    vatNumber: 'LT100016806010',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['pigu.lt', 'pigu'],
    name: 'UAB "Pigu"',
    vatNumber: 'LT100003292317',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['siuntu centras', 'siuntų centras', 'siuntoscentras'],
    name: 'UAB Siuntų centras',
    vatNumber: 'LT100009594113',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['diginet', 'kainos.lt'],
    name: 'UAB "Diginet LTU"',
    vatNumber: 'LT262226314',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['varle'],
    name: 'UAB "VARLE"',
    vatNumber: 'LT100004908613',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['dpd.lt', 'dpd lietuva'],
    name: 'UAB "DPD Lietuva"',
    vatNumber: 'LT119444910',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['edukaciniai'],
    name: 'UAB "Edukaciniai.lt"',
    vatNumber: 'LT100005695318',
    regNumber: 'ND',
    country: 'LT',
  },
  {
    match: ['omniva', 'eesti post'],
    name: 'Omniva',
    vatNumber: 'ND',
    regNumber: 'ND',
    country: 'EE',
  },
  {
    match: ['paysera'],
    name: 'UAB "Paysera LT"',
    vatNumber: 'LT100001354217',
    regNumber: 'ND',
    country: 'LT',
  },
]

// ── Config ───────────────────────────────────────────────────────────

const ISAF_DIR = join(homedir(), '.openclaw', 'isaf')
const INVOICES_DIR = join(homedir(), '.openclaw', 'isaf', 'invoices')

const EMAIL_ADDRESS = process.env.EMAIL_ADDRESS
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD
const IMAP_SERVER = process.env.IMAP_SERVER || 'imap.gmail.com'
const SEND_TO_EMAIL = process.env.SEND_TO_EMAIL || 'kestutis.bajorunas@gmail.com'

if (!EMAIL_ADDRESS || !EMAIL_PASSWORD) {
  console.error('Klaida: EMAIL_ADDRESS ir EMAIL_PASSWORD privalomi.')
  process.exit(1)
}

// ── Parse arguments ──────────────────────────────────────────────────

let monthArg = process.argv[2]
const shouldSend = process.argv.includes('--send')

// Default to previous month when no argument (for cron)
if (!monthArg || monthArg.startsWith('--')) {
  const prev = new Date()
  prev.setMonth(prev.getMonth() - 1)
  monthArg = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}

if (!/^\d{4}-\d{2}$/.test(monthArg)) {
  console.error('Naudojimas: node collect-invoices.mjs <YYYY-MM> [--send]')
  console.error('Pvz.: node collect-invoices.mjs 2026-01 --send')
  process.exit(1)
}

const [year, month] = monthArg.split('-').map(Number)
const startDate = new Date(year, month - 1, 1)
const endDate = new Date(year, month, 0)

const monthDir = join(INVOICES_DIR, monthArg)
mkdirSync(monthDir, { recursive: true })
mkdirSync(ISAF_DIR, { recursive: true })

console.log(`=== Sąskaitų surinkimas: ${monthArg} ===`)
console.log(`Laikotarpis: ${fmtDate(startDate)} – ${fmtDate(endDate)}`)

// ── IMAP helpers ─────────────────────────────────────────────────────

function connectImap() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: EMAIL_ADDRESS,
      password: EMAIL_PASSWORD,
      host: IMAP_SERVER,
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    })
    imap.once('ready', () => resolve(imap))
    imap.once('error', reject)
    imap.connect()
  })
}

function openBox(imap, boxName) {
  return new Promise((resolve, reject) => {
    imap.openBox(boxName, true, (err, box) => {
      if (err) reject(err)
      else resolve(box)
    })
  })
}

function imapSearch(imap, criteria) {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) reject(err)
      else resolve(results || [])
    })
  })
}

function fetchMessage(imap, uid) {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch([uid], { bodies: '', struct: true })
    let rawMessage = ''
    fetch.on('message', (msg) => {
      msg.on('body', (stream) => {
        stream.on('data', (chunk) => { rawMessage += chunk.toString('utf8') })
      })
    })
    fetch.once('end', () => resolve(rawMessage))
    fetch.once('error', reject)
  })
}

// ── Invoice keywords ─────────────────────────────────────────────────

const INVOICE_KEYWORDS = [
  'sąskaita', 'saskaita', 'faktūra', 'faktura',
  'invoice', 'PVM', 'SF', 's/f',
]

// ── Per-supplier PDF scanner templates ────────────────────────────────
// Each template targets a specific PDF layout. The scanner tries templates
// in order and falls back to generic extraction if none match.

const PDF_TEMPLATES = [
  {
    // SKILSAS: "Serija ELP  Nr. 37929\n2026-03-05"
    // "Suma be PVM:41.73 €\nPVM (21.00%):8.77 €\nIš viso su PVM:50.50 €"
    id: 'skilsas',
    detect: (text) => /MB SKILSAS/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/Serija\s*ELP\s*Nr\.?\s*(\d+)/i)?.[1],
      invoiceDate: text.match(/Serija\s*ELP\s*Nr\.?\s*\d+\s*(\d{4}-\d{2}-\d{2})/)?.[1],
      taxableValue: matchAmt(text, /Suma\s*be\s*PVM\s*:\s*(.+?)€/i),
      vatAmount: matchAmt(text, /PVM\s*\(\s*21[\s.]*00?\s*%\s*\)\s*:\s*(.+?)€/i),
      totalAmount: matchAmt(text, /Iš\s*viso\s*su\s*PVM\s*:\s*(.+?)€/i),
    }),
  },
  {
    // TELE2: "Serija M Nr.17190950075\nSąskaitos data2026-02-28"
    // "Apmokestinta 21% PVM tarifu53,68926 €\nPVM (21%)11,27474 €\nIŠ VISO MOKĖTI SU PVM64,96 €"
    id: 'tele2',
    detect: (text) => /Tele2/i.test(text) && /Serija\s*M\s*Nr/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/Serija\s*M\s*Nr\.?\s*(\d+)/i)?.[1],
      invoiceDate: text.match(/S[aą]skaitos\s*data\s*(\d{4}-\d{2}-\d{2})/i)?.[1],
      taxableValue: matchAmt(text, /Apmokestint[ao]\s*21\s*%\s*PVM\s*tarifu\s*(.+?)€/i),
      vatAmount: matchAmt(text, /PVM\s*\(\s*21\s*%\s*\)\s*(.+?)€/i),
      totalAmount: matchAmt(text, /IŠ\s*VISO\s*MOKĖTI\s*SU\s*PVM\s*(.+?)€/i),
    }),
  },
  {
    // DIGINET/KAINOS: "Serija KAINOS Nr. 00367292026-02-28"
    // "Suma be PVM :  9,28 EUR\nPVM suma :  1,95 EUR\nIš viso suma su PVM :  11,23 EUR"
    id: 'diginet',
    detect: (text) => /DIGINET|Kainos/i.test(text) && /Serija\s*KAINOS/i.test(text),
    extract: (text) => {
      // "Serija KAINOS Nr. 00367292026-02-28" — number runs into date
      const hdr = text.match(/Serija\s*KAINOS\s*Nr\.?\s*(\d+?)(\d{4}-\d{2}-\d{2})/i)
      return {
        invoiceNo: hdr ? `KAINOS${hdr[1]}` : null,
        invoiceDate: hdr?.[2] || null,
        taxableValue: matchAmt(text, /Suma\s*be\s*PVM\s*:\s*(.+?)\s*EUR/i),
        vatAmount: matchAmt(text, /PVM\s*suma\s*:\s*(.+?)\s*EUR/i),
        totalAmount: matchAmt(text, /Iš\s*viso\s*suma\s*su\s*PVM\s*:\s*(.+?)\s*EUR/i),
      }
    },
  },
  {
    // VARLE: "PVM SĄSKAITA FAKTŪRA NR. VARTL0758770"
    // "Suma apmokėti EUR\n16.63" / "Apmokestinama PVM\n13.7421 %\nNuo sumosPVM suma\n2.89"
    id: 'varle',
    detect: (text) => /Varle|VARTL/i.test(text) && /FAKTŪRA\s*NR\.\s*VARTL/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/FAKTŪRA\s*NR\.\s*(VARTL\d+)/i)?.[1],
      invoiceDate: text.match(/Dok\.?\s*data\s*\n?\s*.*?\n?\s*(\d{4}\.\d{2}\.\d{2})/)?.[1]?.replace(/\./g, '-')
        || text.match(/(\d{4}\.\d{2}\.\d{2})\s*\n?\s*Dok/)?.[1]?.replace(/\./g, '-'),
      taxableValue: matchAmt(text, /Apmokestinama\s*PVM\s*\n?\s*(.+?)\s*21\s*%/i),
      vatAmount: matchAmt(text, /Iš\s*viso\s*PVM\s*\n?\s*(.+?)(?:\n|Fiz)/i)
        || matchAmt(text, /Nuo\s*sumos\s*PVM\s*suma\s*\n?\s*(.+?)(?:\n|Iš)/i),
      totalAmount: matchAmt(text, /Suma\s*apmokėti\s*EUR\s*\n?\s*(.+?)(?:\n|$)/i),
    }),
  },
  {
    // DPD LIETUVA: "SERIJA 5 Nr:\n2137366" / "Bendra suma\n: 9.34 EUR"
    id: 'dpd',
    detect: (text) => /DPD/i.test(text) && /SERIJA\s*\d+\s*Nr/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/SERIJA\s*\d+\s*Nr\s*:\s*\n?\s*(\d+)/i)?.[1],
      invoiceDate: text.match(/S[aą]skaitos\s*data\s*:\s*(\d{2}\.\d{2}\.\d{4})/i)?.[1]?.replace(/\./g, '-')
        ? normalizeDate(text.match(/S[aą]skaitos\s*data\s*:\s*(\d{2}\.\d{2}\.\d{4})/i)[1]) : null,
      taxableValue: null, // DPD doesn't clearly separate taxable from total in their layout
      vatAmount: null,
      totalAmount: matchAmt(text, /Bendra\s*suma\s*\n?\s*:\s*(.+?)\s*EUR/i),
    }),
  },
  {
    // SIUNTŲ CENTRAS: "Serija ir Nr. SC 7141\nSąskaitos data: 2026-02-28"
    // Has line items, total at bottom: "Iš viso\n665.10"
    id: 'siuntu_centras',
    detect: (text) => /Siuntų\s*centras/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/Serija\s*ir\s*Nr\.?\s*([A-Z]{2,}\s*\d+)/i)?.[1]?.replace(/\s+/g, ''),
      invoiceDate: text.match(/S[aą]skaitos\s*data\s*:\s*(\d{4}-\d{2}-\d{2})/i)?.[1],
      taxableValue: matchAmt(text, /(?:^|\n)\s*Suma\s*be\s*PVM.*?(\d[\d\s.,]+)/i),
      vatAmount: matchAmt(text, /(?:^|\n)\s*PVM.*?suma.*?(\d[\d\s.,]+)/i),
      totalAmount: matchAmt(text, /Iš\s*viso\s*\n?\s*(.+?)(?:\n|$)/i),
    }),
  },
  {
    // LIETUVOS PAŠTAS: "Nr. 1LP000630633\n2026-02-28"
    // "Suma be PVM" and "PVM suma" in table format
    id: 'lietuvos_pastas',
    detect: (text) => /Lietuvos\s*paštas/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/Nr\.?\s*(1LP\d+)/i)?.[1],
      invoiceDate: text.match(/Nr\.?\s*1LP\d+\s*\n?\s*(\d{4}-\d{2}-\d{2})/i)?.[1],
      taxableValue: matchAmt(text, /Suma\s*be\s*PVM.*?(\d[\d\s.,]+)/i),
      vatAmount: matchAmt(text, /PVM\s*suma.*?(\d[\d\s.,]+)/i),
      totalAmount: matchAmt(text, /Viso.*?mokėti.*?(\d[\d\s.,]+)/i)
        || matchAmt(text, /Iš\s*viso.*?(\d[\d\s.,]+)/i),
    }),
  },
  {
    // OPEN24: "No.\tOPN-01094939\nDate:\t2026-03-17"
    // "Amount\texcl.\tVAT:297,10745\t€\nVAT\t21\tpercent:62,39255\t€\nGrand\ttotal:359,50\t€"
    id: 'open24',
    detect: (text) => /Open\s*24/i.test(text) && /OPN-/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/No\.?\s*\t?\s*(OPN-\d+)/i)?.[1]?.replace(/-/g, ''),
      invoiceDate: text.match(/Date\s*:\s*\t?\s*(\d{4}-\d{2}-\d{2})/i)?.[1],
      taxableValue: matchAmt(text, /Amount\s*excl\.?\s*VAT\s*:\s*(.+?)\s*€/i),
      vatAmount: matchAmt(text, /VAT\s*21\s*percent\s*:\s*(.+?)\s*€/i),
      totalAmount: matchAmt(text, /Grand\s*total\s*:\s*(.+?)\s*€/i),
    }),
  },
  {
    // EDUKACINIAI / UZU: "Užsakymas: 1000052234\nUžsakymo data: 2026-03-13"
    id: 'edukaciniai',
    detect: (text) => /edukaciniai|UAB\s*UZU/i.test(text),
    extract: (text) => ({
      invoiceNo: text.match(/Užsakymas\s*:\s*(\d+)/i)?.[1],
      invoiceDate: text.match(/Užsakymo\s*data\s*:\s*(\d{4}-\d{2}-\d{2})/i)?.[1],
      taxableValue: matchAmt(text, /Suma\s*be\s*PVM\s*:?\s*(.+?)\s*€/i),
      vatAmount: matchAmt(text, /PVM\s*(?:suma)?\s*:?\s*(.+?)\s*€/i),
      totalAmount: matchAmt(text, /(?:Viso|Iš\s*viso)\s*:?\s*(.+?)\s*€/i),
    }),
  },
]

/** Match an amount from text using a regex, return parsed float or null */
function matchAmt(text, pattern) {
  const m = text.match(pattern)
  if (!m) return null
  const val = parseAmount(m[1])
  return isNaN(val) ? null : val
}

// ── PDF data extraction ──────────────────────────────────────────────

async function extractPdfData(pdfBuffer) {
  try {
    const parsed = await pdfParse(pdfBuffer)
    const text = parsed?.text || ''
    if (!text || text.length < 10) return null

    const result = {
      invoiceNo: null,
      supplierName: null,
      supplierVat: null,
      supplierReg: null,
      taxableValue: null,
      vatAmount: null,
      totalAmount: null,
      invoiceDate: null,
    }

    // Try per-supplier templates first
    for (const tpl of PDF_TEMPLATES) {
      if (tpl.detect(text)) {
        const extracted = tpl.extract(text)
        if (extracted.invoiceNo) result.invoiceNo = extracted.invoiceNo
        if (extracted.invoiceDate) result.invoiceDate = extracted.invoiceDate
        if (extracted.taxableValue) result.taxableValue = extracted.taxableValue
        if (extracted.vatAmount) result.vatAmount = extracted.vatAmount
        if (extracted.totalAmount) result.totalAmount = extracted.totalAmount
        break
      }
    }

    // VAT number - first LT number that is NOT our own
    const vatMatches = text.matchAll(/\b(LT\d{8,12})\b/g)
    for (const m of vatMatches) {
      if (m[1] !== COMPANY.vatCode) { result.supplierVat = m[1]; break }
    }

    // Company registration number - first one that's not ours
    const regMatches = text.matchAll(/(?:Įmonės\s*kodas|kodas)\s*[:\s]*(\d{9})/gi)
    for (const m of regMatches) {
      if (m[1] !== COMPANY.registrationNumber) { result.supplierReg = m[1]; break }
    }

    // Generic fallback for amounts if template didn't extract them
    if (!result.taxableValue && !result.vatAmount && !result.totalAmount) {
      const AMT = '([\\d\\s]+[.,]\\d{2,})'

      // Taxable
      const taxPatterns = [
        new RegExp(`Apmokestint[ao]\\s*21\\s*%\\s*PVM\\s*tarifu\\s*${AMT}`, 'i'),
        new RegExp(`(?:Suma|Viso|Bendra\\s*suma)\\s*be\\s*PVM\\s*[:\\s]*${AMT}`, 'i'),
        new RegExp(`Amount\\s*excl\\.?\\s*VAT\\s*[:\\s]*${AMT}`, 'i'),
      ]
      for (const p of taxPatterns) {
        const m = text.match(p)
        if (m) { result.taxableValue = parseAmount(m[1]); break }
      }

      // VAT
      const vatPatterns = [
        new RegExp(`PVM\\s*\\(?\\s*21\\s*%\\s*\\)?\\s*${AMT}`, 'i'),
        new RegExp(`PVM\\s*(?:suma|mokestis)\\s*[:\\s]*${AMT}`, 'i'),
        new RegExp(`VAT\\s*(?:amount)?\\s*[:\\s]*${AMT}`, 'i'),
      ]
      for (const p of vatPatterns) {
        const m = text.match(p)
        if (m) { result.vatAmount = parseAmount(m[1]); break }
      }

      // Total
      const totalPatterns = [
        new RegExp(`IŠ\\s*VISO\\s*(?:MOKĖTI\\s*)?(?:SU\\s*PVM)?\\s*${AMT}`, 'i'),
        new RegExp(`(?:Mokėtina\\s*suma|Iš\\s*viso|Viso\\s*su\\s*PVM)\\s*[:\\s]*${AMT}`, 'i'),
        new RegExp(`(?:Grand\\s*total|Total|Amount\\s*due)\\s*[:\\s]*${AMT}`, 'i'),
      ]
      for (const p of totalPatterns) {
        const m = text.match(p)
        if (m) { result.totalAmount = parseAmount(m[1]); break }
      }
    }

    // Calculate missing values
    if (result.totalAmount && !result.taxableValue && !result.vatAmount) {
      result.taxableValue = roundTo2(result.totalAmount / 1.21)
      result.vatAmount = roundTo2(result.totalAmount - result.taxableValue)
    }
    if (result.taxableValue && !result.vatAmount) {
      result.vatAmount = roundTo2(result.taxableValue * 0.21)
    }
    if (result.vatAmount && !result.taxableValue) {
      result.taxableValue = roundTo2(result.vatAmount / 0.21)
    }

    // Invoice date fallback (generic patterns)
    if (!result.invoiceDate) {
      const datePatterns = [
        /(?:S[aą]skaitos?\s*data|Data|Invoice\s*date|Date)\s*[:\s]*(\d{4}[.-]\d{2}[.-]\d{2})/i,
        /(?:Data|Date)\s*[:\s]*(\d{2}[.-]\d{2}[.-]\d{4})/i,
      ]
      for (const p of datePatterns) {
        const m = text.match(p)
        if (m) { result.invoiceDate = normalizeDate(m[1]); break }
      }
    }

    // Invoice number fallback (generic patterns)
    if (!result.invoiceNo) {
      const invNoPatterns = [
        /Serija\s*[A-Z]+\s*Nr\.?\s*(\d+)/i,
        /FAKTŪRA\s*NR\.?\s*([A-Z]*\d[\w/-]*)/i,
        /(?:Nr\.?|NR\.?)\s+([A-Z]{2,}[\s-]?\d[\w/-]*)/i,
        /(?:Nr\.?|NR\.?)\s+(\d{4,}[\w/-]*)/i,
      ]
      for (const p of invNoPatterns) {
        const m = text.match(p)
        if (m) {
          const no = m[1].trim().replace(/\s+/g, '')
          if (/^(PVM|SF|VAT)$/i.test(no)) continue
          result.invoiceNo = no
          break
        }
      }
    }

    return result
  } catch {
    return null
  }
}

function parseAmount(str) {
  return parseFloat(str.replace(/\s/g, '').replace(',', '.'))
}

function roundTo2(n) {
  return Math.round(n * 100) / 100
}

function normalizeDate(str) {
  // "2026-01-15" or "2026.01.15" -> "2026-01-15"
  // "15-01-2026" or "15.01.2026" -> "2026-01-15"
  const parts = str.split(/[.-]/)
  if (parts[0].length === 4) return parts.join('-')
  return `${parts[2]}-${parts[1]}-${parts[0]}`
}

// ── Supplier matching ────────────────────────────────────────────────

function matchKnownSupplier(fromStr, subject) {
  const searchStr = `${fromStr} ${subject}`.toLowerCase()
  for (const s of KNOWN_SUPPLIERS) {
    if (s.match.some((m) => searchStr.includes(m.toLowerCase()))) {
      return { ...s }
    }
  }
  return null
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const imap = await connectImap()
  console.log('Prisijungta prie Gmail IMAP.')

  // Search All Mail to include archived/moved emails
  await openBox(imap, '[Gmail]/Visi laiškai')

  const sinceStr = fmtImapDate(startDate)
  const beforeStr = fmtImapDate(new Date(year, month, 1))

  const uids = await imapSearch(imap, [
    ['SINCE', sinceStr],
    ['BEFORE', beforeStr],
  ])

  console.log(`Rasta laiškų per ${monthArg}: ${uids.length}`)

  if (uids.length === 0) {
    console.log('Nėra laiškų šiam laikotarpiui.')
    imap.end()
    return
  }

  const invoices = []
  let pdfCount = 0

  for (const uid of uids) {
    try {
      const raw = await fetchMessage(imap, uid)
      const parsed = await simpleParser(raw)

      const subject = parsed.subject || ''
      const from = parsed.from?.text || ''
      const date = parsed.date

      const pdfAttachments = (parsed.attachments || []).filter(
        (a) => a.contentType === 'application/pdf'
          || (a.filename || '').toLowerCase().endsWith('.pdf'),
      )

      if (pdfAttachments.length === 0) continue

      // Skip emails sent FROM our own company (outgoing invoices, not purchases)
      const fromEmail = parsed.from?.value?.[0]?.address || ''
      const fromLower = from.toLowerCase()
      if (fromLower.includes('bajora') || fromLower.includes('liuti.lt') || fromLower.includes('liutikids')) {
        continue
      }

      const textToSearch = `${subject} ${from}`.toLowerCase()
      const isInvoice = INVOICE_KEYWORDS.some((kw) => textToSearch.includes(kw.toLowerCase()))
      const hasInvoiceFilename = pdfAttachments.some((a) => {
        const fn = (a.filename || '').toLowerCase()
        return INVOICE_KEYWORDS.some((kw) => fn.includes(kw.toLowerCase()))
      })

      if (!isInvoice && !hasInvoiceFilename) continue

      console.log(`\n  Sąskaita: ${subject}`)
      console.log(`  Nuo: ${from}`)

      // Match known supplier
      const knownSupplier = matchKnownSupplier(from, subject)
      if (knownSupplier) {
        console.log(`  Tiekėjas: ${knownSupplier.name} (${knownSupplier.vatNumber})`)
      }

      // Save PDFs and extract data
      let pdfData = null
      for (const att of pdfAttachments) {
        const safeFilename = sanitizeFilename(att.filename || `invoice-${uid}.pdf`)
        const pdfPath = join(monthDir, safeFilename)

        if (!existsSync(pdfPath)) {
          writeFileSync(pdfPath, att.content)
          console.log(`  PDF: ${safeFilename}`)
        } else {
          console.log(`  PDF: ${safeFilename} (jau yra)`)
        }

        // Try to extract data from first PDF
        if (!pdfData) {
          pdfData = await extractPdfData(att.content)
          if (pdfData) {
            if (pdfData.taxableValue) console.log(`  Suma be PVM: ${pdfData.taxableValue}`)
            if (pdfData.vatAmount) console.log(`  PVM: ${pdfData.vatAmount}`)
            if (pdfData.totalAmount) console.log(`  Viso: ${pdfData.totalAmount}`)
            if (pdfData.invoiceNo) console.log(`  SF Nr.: ${pdfData.invoiceNo}`)
            if (pdfData.invoiceDate) console.log(`  Data: ${pdfData.invoiceDate}`)
          } else {
            console.log(`  [!] PDF teksto nepavyko nuskaityti`)
          }
        }

        pdfCount++
      }

      // Extract invoice number from PDF filename as fallback (e.g., "elp-36903_name.pdf" -> "ELP36903")
      const filenameInvoiceNo = extractInvoiceNoFromFilename(pdfAttachments[0]?.filename)

      // Sanity-check extracted amounts (reject obviously wrong values > 1M EUR)
      const MAX_AMOUNT = 1_000_000
      if (pdfData) {
        if (pdfData.taxableValue > MAX_AMOUNT) pdfData.taxableValue = null
        if (pdfData.vatAmount > MAX_AMOUNT) pdfData.vatAmount = null
        if (pdfData.totalAmount > MAX_AMOUNT) pdfData.totalAmount = null
      }

      // Invoice number: prefer filename-based (more reliable), then subject, then PDF text
      const subjectInvoiceNo = extractInvoiceNumber(subject)
      const invoiceNo = filenameInvoiceNo || subjectInvoiceNo || pdfData?.invoiceNo || null

      const invoice = {
        uid,
        subject,
        from,
        fromEmail: parsed.from?.value?.[0]?.address || '',
        date: date ? fmtDate(date) : null,
        isoDate: date ? date.toISOString().split('T')[0] : null,
        pdfFiles: pdfAttachments.map((a) => sanitizeFilename(a.filename || `invoice-${uid}.pdf`)),
        invoiceNo,
        supplierName: knownSupplier?.name || extractSupplierName(from),
        supplierVat: pdfData?.supplierVat || knownSupplier?.vatNumber || 'ND',
        supplierReg: pdfData?.supplierReg || knownSupplier?.regNumber || 'ND',
        supplierCountry: knownSupplier?.country || 'LT',
        taxableValue: pdfData?.taxableValue != null ? roundTo2(pdfData.taxableValue) : null,
        vatAmount: pdfData?.vatAmount != null ? roundTo2(pdfData.vatAmount) : null,
        totalAmount: pdfData?.totalAmount != null ? roundTo2(pdfData.totalAmount) : null,
        invoiceDate: pdfData?.invoiceDate || null,
      }

      // Filter: invoice date must fall within the selected period
      const invDate = invoice.invoiceDate || invoice.isoDate
      if (invDate) {
        const invDateObj = new Date(invDate)
        if (invDateObj < startDate || invDateObj > endDate) {
          console.log(`  Ne šio laikotarpio: ${invDate} (praleista)`)
          continue
        }
      }

      // Deduplicate: skip if same invoice number already collected
      // If existing has no amounts but new one does, replace it
      if (invoice.invoiceNo) {
        const existingIdx = invoices.findIndex((i) => i.invoiceNo === invoice.invoiceNo)
        if (existingIdx !== -1) {
          const existing = invoices[existingIdx]
          if (existing.taxableValue == null && invoice.taxableValue != null) {
            console.log(`  Dublikatas: ${invoice.invoiceNo} (pakeista – geresnė versija)`)
            invoices[existingIdx] = invoice
          } else {
            console.log(`  Dublikatas: ${invoice.invoiceNo} (praleista)`)
          }
          continue
        }
      }

      // Deduplicate: skip if same PDF filename already in another invoice
      if (!invoice.invoiceNo && invoice.pdfFiles.length > 0) {
        const isDupPdf = invoices.some((i) =>
          i.pdfFiles.some((f) => invoice.pdfFiles.includes(f)),
        )
        if (isDupPdf) {
          console.log(`  Dublikatas PDF: ${invoice.pdfFiles[0]} (praleista)`)
          continue
        }
      }

      invoices.push(invoice)
    } catch (err) {
      console.error(`  Klaida apdorojant laišką ${uid}: ${err.message}`)
    }
  }

  imap.end()

  console.log(`\n=== Rezultatai ===`)
  console.log(`Sąskaitų rasta: ${invoices.length}`)
  console.log(`PDF failų: ${pdfCount}`)
  console.log(`Katalogas: ${monthDir}`)

  if (invoices.length === 0) {
    console.log('Nerasta sąskaitų su PDF priedais.')
    return
  }

  // Print summary table
  console.log(`\n  Tiekėjas                         | PVM kodas        | Suma be PVM | PVM     | SF Nr.`)
  console.log(`  ${'─'.repeat(95)}`)
  for (const inv of invoices) {
    const name = (inv.supplierName || '?').padEnd(33)
    const vat = (inv.supplierVat || 'ND').padEnd(17)
    const taxable = inv.taxableValue != null ? String(inv.taxableValue).padStart(11) : '         ? '
    const vatAmt = inv.vatAmount != null ? String(inv.vatAmount).padStart(7) : '     ? '
    const invNo = inv.invoiceNo || '?'
    console.log(`  ${name}| ${vat}| ${taxable} | ${vatAmt} | ${invNo}`)
  }

  // Save manifest
  const manifestPath = join(monthDir, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(invoices, null, 2))
  console.log(`\nManifestas: ${manifestPath}`)

  // Generate i.SAF XML
  const isafXml = generateIsafXml(invoices, monthArg)
  const isafPath = join(ISAF_DIR, `isaf-${monthArg}.xml`)
  writeFileSync(isafPath, isafXml, 'utf-8')
  console.log(`i.SAF XML: ${isafPath}`)

  // Send email if --send
  if (shouldSend) {
    console.log(`\nSiunčiama į: ${SEND_TO_EMAIL}...`)
    try {
      await sendIsafEmail(isafPath, monthArg, invoices.length)
      console.log('Laiškas išsiųstas sėkmingai!')
    } catch (err) {
      console.error(`Klaida siunčiant laišką: ${err.message}`)
    }
  }

  console.log(`\n=== Baigta ===`)
}

// ── i.SAF XML generation ─────────────────────────────────────────────

function generateIsafXml(invoices, monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  const startStr = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const endStr = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  // Collect unique suppliers (by VAT number or name)
  const suppliersMap = new Map()
  for (const inv of invoices) {
    const key = inv.supplierVat !== 'ND' ? inv.supplierVat : inv.supplierName
    if (!suppliersMap.has(key)) {
      suppliersMap.set(key, {
        id: `S${String(suppliersMap.size + 1).padStart(4, '0')}`,
        name: inv.supplierName,
        vatNumber: inv.supplierVat || 'ND',
        regNumber: inv.supplierReg || 'ND',
        country: inv.supplierCountry || 'LT',
      })
    }
  }

  const suppliers = [...suppliersMap.values()]

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<iSAFFile xmlns="http://www.vmi.lt/cms/imas/isaf">
\t<Header>
\t\t<FileDescription>
\t\t\t<FileVersion>iSAF1.2</FileVersion>
\t\t\t<FileDateCreated>${now}</FileDateCreated>
\t\t\t<DataType>P</DataType>
\t\t\t<SoftwareCompanyName>OpenClaw</SoftwareCompanyName>
\t\t\t<SoftwareName>OpenClaw iSAF</SoftwareName>
\t\t\t<SoftwareVersion>1.0</SoftwareVersion>
\t\t\t<RegistrationNumber>${COMPANY.registrationNumber}</RegistrationNumber>
\t\t\t<NumberOfParts>1</NumberOfParts>
\t\t\t<PartNumber>1</PartNumber>
\t\t\t<SelectionCriteria>
\t\t\t\t<SelectionStartDate>${startStr}</SelectionStartDate>
\t\t\t\t<SelectionEndDate>${endStr}</SelectionEndDate>
\t\t\t</SelectionCriteria>
\t\t</FileDescription>
\t</Header>
\t<MasterFiles>
\t\t<Suppliers>`

  for (const s of suppliers) {
    xml += `
\t\t\t<Supplier>
\t\t\t\t<SupplierID>${esc(s.id)}</SupplierID>
\t\t\t\t<VATRegistrationNumber>${esc(s.vatNumber)}</VATRegistrationNumber>
\t\t\t\t<RegistrationNumber>${esc(s.regNumber)}</RegistrationNumber>
\t\t\t\t<Country>${esc(s.country)}</Country>
\t\t\t\t<Name>${esc(s.name)}</Name>
\t\t\t</Supplier>`
  }

  xml += `
\t\t</Suppliers>
\t</MasterFiles>
\t<SourceDocuments>
\t\t<PurchaseInvoices>`

  for (const inv of invoices) {
    const supplierKey = inv.supplierVat !== 'ND' ? inv.supplierVat : inv.supplierName
    const supplier = suppliersMap.get(supplierKey)
    const invoiceNo = inv.invoiceNo || `EMAIL-${inv.uid}`
    const invoiceDate = inv.invoiceDate || inv.isoDate || startStr
    const taxableValue = roundTo2(inv.taxableValue ?? 0)
    const vatAmount = roundTo2(inv.vatAmount ?? 0)

    xml += `
\t\t\t<Invoice>
\t\t\t\t<InvoiceNo>${esc(invoiceNo)}</InvoiceNo>
\t\t\t\t<SupplierInfo>
\t\t\t\t\t<SupplierID>${esc(supplier.id)}</SupplierID>
\t\t\t\t\t<VATRegistrationNumber>${esc(supplier.vatNumber)}</VATRegistrationNumber>
\t\t\t\t\t<RegistrationNumber>${esc(supplier.regNumber)}</RegistrationNumber>
\t\t\t\t\t<Country>${esc(supplier.country)}</Country>
\t\t\t\t\t<Name>${esc(supplier.name)}</Name>
\t\t\t\t</SupplierInfo>
\t\t\t\t<InvoiceDate>${invoiceDate}</InvoiceDate>
\t\t\t\t<InvoiceType>SF</InvoiceType>
\t\t\t\t<SpecialTaxation/>
\t\t\t\t<References/>
\t\t\t\t<VATPointDate>${invoiceDate}</VATPointDate>
\t\t\t\t<RegistrationAccountDate>${invoiceDate}</RegistrationAccountDate>
\t\t\t\t<DocumentTotals>
\t\t\t\t\t<DocumentTotal>
\t\t\t\t\t\t<TaxableValue>${taxableValue}</TaxableValue>
\t\t\t\t\t\t<TaxCode>PVM1</TaxCode>
\t\t\t\t\t\t<TaxPercentage>21</TaxPercentage>
\t\t\t\t\t\t<Amount>${vatAmount}</Amount>
\t\t\t\t\t</DocumentTotal>
\t\t\t\t</DocumentTotals>
\t\t\t</Invoice>`
  }

  xml += `
\t\t</PurchaseInvoices>
\t</SourceDocuments>
</iSAFFile>
`

  return xml
}

// ── Email sending ────────────────────────────────────────────────────

async function sendIsafEmail(xmlPath, monthStr, invoiceCount) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: EMAIL_ADDRESS, pass: EMAIL_PASSWORD },
    tls: { rejectUnauthorized: false },
  })

  await transporter.sendMail({
    from: `MB Bajora <${EMAIL_ADDRESS}>`,
    to: SEND_TO_EMAIL,
    subject: `i.SAF rinkmena ${monthStr} - MB Bajora (${invoiceCount} sąskaitų)`,
    text: [
      'Sveiki,',
      '',
      `Pridedama i.SAF rinkmena už ${monthStr}.`,
      `Sąskaitų skaičius: ${invoiceCount}`,
      '',
      'Pagarbiai,',
      'OpenClaw iSAF',
    ].join('\n'),
    attachments: [{ filename: `isaf-${monthStr}.xml`, path: xmlPath }],
  })
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtDate(d) {
  return d.toISOString().split('T')[0]
}

function fmtImapDate(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d.getDate()}-${months[d.getMonth()]}-${d.getFullYear()}`
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 200)
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function extractInvoiceNoFromFilename(filename) {
  if (!filename) return null
  const base = filename.replace(/\.pdf$/i, '')

  // "INV_52137366_5788150_LT.pdf" -> "52137366"
  const invMatch = base.match(/INV[_-](\d{5,})/i)
  if (invMatch) return invMatch[1]

  // "InvoiceNr._UZU_1000052234.pdf" -> "UZU1000052234"
  const uzuMatch = base.match(/InvoiceNr[._]+([A-Z]{2,})[_-]?(\d{5,})/i)
  if (uzuMatch) return `${uzuMatch[1].toUpperCase()}${uzuMatch[2]}`

  // "Saskaita_faktura_1LP000630633.pdf" -> "1LP000630633"
  const sfMatch = base.match(/[Ss]askaita[_\s]*faktura[_\s]*(\w{2,}\d{5,})/)
  if (sfMatch) return sfMatch[1]

  // "SC_7141_2026-02-28_..." -> "SC7141"
  const scMatch = base.match(/^([A-Z]{2,})[_-](\d{3,})/)
  if (scMatch) {
    const prefix = scMatch[1].toUpperCase()
    if (!/^(PRE|IMG|DOC|PDF|ATT)$/.test(prefix)) return `${prefix}${scMatch[2]}`
  }

  // "VARTL0758770.pdf" -> "VARTL0758770"
  const codeMatch = base.match(/^([A-Z]{2,}\d{5,})/i)
  if (codeMatch) return codeMatch[1].toUpperCase()

  // "elp-36903_name.pdf" -> "ELP36903"
  // "OPN-01077822.pdf" -> "OPN01077822"
  const m = base.match(/^([a-zA-Z]{2,4})-?(\d{4,})/)
  if (m) {
    const prefix = m[1].toUpperCase()
    if (/^(PRE|IMG|DOC|PDF|ATT)$/.test(prefix)) return null
    return `${prefix}${m[2]}`
  }

  // "2026_02_28_invoice.pdf" -> null (date-only filenames are not useful)
  return null
}

function extractInvoiceNumber(subject) {
  if (!subject) return null
  const patterns = [
    /\bORD\s+(\d+)/,
    /(?:Nr\.?|NR\.?|#)\s*([A-Z]*\d[\w-]*)/i,
    /(?:fakt[uū]ra|invoice)\s+([A-Z0-9][\w-]*)/i,
    /\b(SF[\s.-]*\d[\w/-]*)/i,
    /\b([A-Z]{2,}\d{4,})\b/,
    /\b(\d[A-Z]{2,}\d{6,})\b/,
    /(\d{5,})/,
  ]
  for (const p of patterns) {
    const m = subject.match(p)
    if (m) return m[1].trim()
  }
  return null
}

function extractSupplierName(fromStr) {
  if (!fromStr) return 'Nežinomas tiekėjas'
  const m = fromStr.match(/^"?([^"<]+)"?\s*</)
  if (m) {
    const name = m[1].trim()
    if (!/^(info|saskaitos|noreply|no-reply|billing|invoices?)$/i.test(name)) {
      return name
    }
  }
  const emailMatch = fromStr.match(/@([\w.-]+)/)
  if (emailMatch) {
    const domainName = emailMatch[1].split('.')[0]
    return domainName.charAt(0).toUpperCase() + domainName.slice(1)
  }
  return fromStr
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Klaida:', err.message)
  process.exit(1)
})
