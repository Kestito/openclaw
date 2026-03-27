#!/usr/bin/env node

// Generate a Lithuanian credit note PDF (kreditinė PVM sąskaita faktūra)
// from a WooCommerce order that has been refunded (fully or partially).
//
// Usage: node generate-credit-note.mjs <order_id>
// Requires env: WOO_KEY, WOO_SECRET
// Output: ~/.openclaw/invoices/kreditine-<order_id>.pdf
//
// Per LT requirements, a credit note must:
// - Reference the original invoice number (Serija B Nr. <id>)
// - Show refunded amounts as negative values
// - Include VAT breakdown of the refunded amounts
// - Be titled "KREDITINĖ PVM SĄSKAITA FAKTŪRA"

import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { request } from 'node:https'
import PDFDocument from 'pdfkit'

// ── Config ───────────────────────────────────────────────────────────

const SELLER = {
  name: 'MB Bajora',
  companyCode: '303236293',
  vatCode: 'LT100014310611',
  address: 'Skatulės g. 17A, LT-06298 Vilnius',
  bank: 'Paysera',
  account: 'LT623500010001211320',
  website: 'www.liuti.lt',
}

const STORE_URL = 'https://www.liuti.lt'
const DEFAULT_VAT_RATE = 21

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

// ── Env validation ───────────────────────────────────────────────────

const WOO_KEY = process.env.WOO_KEY
const WOO_SECRET = process.env.WOO_SECRET

if (!WOO_KEY || !WOO_SECRET) {
  console.error('Klaida: WOO_KEY ir WOO_SECRET aplinkos kintamieji privalomi.')
  process.exit(1)
}

const orderId = process.argv[2]
if (!orderId || !/^\d+$/.test(orderId)) {
  console.error('Naudojimas: node generate-credit-note.mjs <užsakymo_id>')
  process.exit(1)
}

// ── HTTP helpers ─────────────────────────────────────────────────────

function httpGet(url) {
  const auth = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64')
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 30_000,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
          return
        }
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error('Netinkamas JSON atsakymas')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Užklausa baigėsi laiku')) })
    req.end()
  })
}

async function fetchOrder(id) {
  const url = new URL(`/wp-json/wc/v3/orders/${id}`, STORE_URL)
  try {
    return await httpGet(url)
  } catch (err) {
    console.error(`Klaida: nepavyko gauti užsakymo #${id}: ${err.message}`)
    process.exit(1)
  }
}

async function fetchRefunds(id) {
  const url = new URL(`/wp-json/wc/v3/orders/${id}/refunds`, STORE_URL)
  try {
    return await httpGet(url)
  } catch (err) {
    console.error(`Klaida: nepavyko gauti grąžinimų užsakymui #${id}: ${err.message}`)
    process.exit(1)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function fmtDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function fmtMoney(val) {
  return Number(val).toFixed(2)
}

function billingBlock(b) {
  const parts = [
    [b.first_name, b.last_name].filter(Boolean).join(' '),
    b.company,
    b.address_1,
    b.address_2,
    [b.postcode, b.city].filter(Boolean).join(' '),
    b.country,
  ]
  return parts.filter(Boolean)
}

function vatFromGross(gross, rate = DEFAULT_VAT_RATE) {
  if (rate === 0) return { net: gross, vat: 0, rate }
  const net = gross / (1 + rate / 100)
  const vat = gross - net
  return { net, vat, rate }
}

// Detect VAT rate from a WooCommerce line item.
// When prices_include_tax=true and WC has no tax config, taxes[] is empty — default to 21%.
function detectVatRate(item, pricesIncludeTax = false) {
  const taxes = item.taxes
  if (Array.isArray(taxes) && taxes.length > 0) {
    const tax = taxes[0]
    const totalTax = Math.abs(Number(tax.total))
    const subtotal = Math.abs(Number(tax.subtotal || tax.total))
    const taxAmount = subtotal > 0 ? subtotal : totalTax
    const itemSubtotal = Math.abs(Number(item.subtotal || item.total))
    if (itemSubtotal > 0 && taxAmount > 0) {
      const computed = Math.round((taxAmount / itemSubtotal) * 100)
      if ([21, 9, 5, 0].includes(computed)) return computed
    }
  }
  if (pricesIncludeTax) return DEFAULT_VAT_RATE
  if (Number(item.total_tax) === 0 && Number(item.total) !== 0) return 0
  return DEFAULT_VAT_RATE
}

// ── PDF generation ───────────────────────────────────────────────────

function generateCreditNotePdf(order, refunds, outputPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const stream = createWriteStream(outputPath)
  doc.pipe(stream)

  const leftX = 50
  const pageWidth = doc.page.width - 100

  // Aggregate all refunds (WC refund API uses 'amount', not 'total')
  const pricesIncludeTax = order.prices_include_tax
  const totalRefunded = refunds.reduce((s, r) => s + Math.abs(Number(r.amount || r.total)), 0)
  const isFullRefund = totalRefunded >= Number(order.total)

  // Collect all refunded line items across all refunds
  const refundedItems = []
  for (const refund of refunds) {
    for (const item of (refund.line_items || [])) {
      refundedItems.push({ ...item, refundId: refund.id, refundDate: refund.date_created, refundReason: refund.reason })
    }
  }

  // ── Header ─────────────────────────────────────────────────────────
  doc
    .fontSize(18)
    .font(FONT_BOLD)
    .text('KREDITINĖ PVM SĄSKAITA FAKTŪRA', { align: 'center' })
    .moveDown(0.2)

  doc
    .fontSize(11)
    .font(FONT)
    .text(`Serija KB Nr. ${order.id}`, { align: 'center' })
    .moveDown(0.2)

  doc
    .fontSize(10)
    .text(`Išrašymo data: ${fmtDate(new Date().toISOString())}`, { align: 'center' })
    .moveDown(0.2)

  doc
    .fontSize(9)
    .text(`Susijusi sąskaita faktūra: Serija B Nr. ${order.id} (${fmtDate(order.date_created)})`, { align: 'center' })
    .moveDown(1.0)

  // ── Seller / Buyer ─────────────────────────────────────────────────
  const rightX = 310
  const infoY = doc.y
  const lineH = 13

  doc.font(FONT_BOLD).fontSize(9)
  doc.text('Pardavėjas (Tiekėjas):', leftX, infoY)
  doc.font(FONT).fontSize(9)
  let sy = infoY + lineH + 2
  doc.text(SELLER.name, leftX, sy); sy += lineH
  if (SELLER.companyCode) { doc.text(`Įmonės kodas: ${SELLER.companyCode}`, leftX, sy); sy += lineH }
  if (SELLER.vatCode) { doc.text(`PVM mok. kodas: ${SELLER.vatCode}`, leftX, sy); sy += lineH }
  if (SELLER.address) { doc.text(`Adresas: ${SELLER.address}`, leftX, sy); sy += lineH }
  if (SELLER.bank) { doc.text(`Bankas: ${SELLER.bank}`, leftX, sy); sy += lineH }
  if (SELLER.account) { doc.text(`A/S: ${SELLER.account}`, leftX, sy); sy += lineH }
  doc.text(SELLER.website, leftX, sy); sy += lineH

  doc.font(FONT_BOLD).fontSize(9)
  doc.text('Pirkėjas:', rightX, infoY)
  doc.font(FONT).fontSize(9)
  let by = infoY + lineH + 2
  const buyerLines = billingBlock(order.billing)
  for (const line of buyerLines) {
    doc.text(line, rightX, by); by += lineH
  }
  if (order.billing.email) { doc.text(order.billing.email, rightX, by); by += lineH }
  if (order.billing.phone) { doc.text(`Tel.: ${order.billing.phone}`, rightX, by); by += lineH }

  doc.y = Math.max(sy, by) + 15

  // ── Refund reason ──────────────────────────────────────────────────
  const reasons = [...new Set(refunds.map((r) => r.reason).filter(Boolean))]
  if (reasons.length > 0) {
    doc.font(FONT).fontSize(9)
    doc.text(`Grąžinimo priežastis: ${reasons.join('; ')}`, leftX, doc.y, { width: pageWidth })
    doc.moveDown(0.5)
  }

  doc.moveDown(0.3)

  // ── Decide: full refund (mirror original) vs partial (refund lines) ──

  if (isFullRefund && refundedItems.length === 0) {
    generateFullRefundTable(doc, order, leftX, pageWidth, pricesIncludeTax)
  } else if (refundedItems.length > 0) {
    generateRefundLinesTable(doc, refundedItems, leftX, pageWidth, pricesIncludeTax)
  } else {
    generateLumpSumRefund(doc, order, totalRefunded, leftX, pageWidth)
  }

  // ── Footer ─────────────────────────────────────────────────────────
  doc.moveDown(1.5)
  doc.fontSize(8).fillColor('#666666')
  doc.text(
    'Kreditinė sąskaita faktūra galioja be parašo ir antspaudo (LR buhalterinės apskaitos įstatymas, 13 str. 1 d.)',
    leftX, doc.y, { align: 'center', width: pageWidth },
  )
  doc.fillColor('#000000')

  doc.end()

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

// Full refund: mirror original order items as negative amounts
function generateFullRefundTable(doc, order, leftX, pageWidth, pricesIncludeTax = false) {
  const col = { nr: 22, name: 180, qty: 35, unitPrice: 70, vatPct: 35, vatAmt: 60, totalVat: 0 }
  col.totalVat = pageWidth - col.nr - col.name - col.qty - col.unitPrice - col.vatPct - col.vatAmt

  // Table header
  const tableTop = doc.y
  doc.font(FONT_BOLD).fontSize(8)
  let x = leftX
  const headers = [
    ['Nr.', col.nr, 'left'],
    ['Pavadinimas', col.name, 'left'],
    ['Kiekis', col.qty, 'right'],
    ['Vnt. kaina\nbe PVM', col.unitPrice, 'right'],
    ['PVM %', col.vatPct, 'right'],
    ['PVM suma', col.vatAmt, 'right'],
    ['Suma su\nPVM', col.totalVat, 'right'],
  ]
  for (const [label, w, align] of headers) {
    doc.text(label, x, tableTop, { width: w, align })
    x += w
  }

  const headerBottom = tableTop + 22
  doc.moveTo(leftX, headerBottom).lineTo(leftX + pageWidth, headerBottom).lineWidth(0.5).stroke()

  doc.font(FONT).fontSize(8)
  let rowY = headerBottom + 5
  let totalNet = 0
  let totalVat = 0
  const vatByRate = {}

  for (let idx = 0; idx < order.line_items.length; idx++) {
    const item = order.line_items[idx]
    const rate = detectVatRate(item, pricesIncludeTax)
    const gross = pricesIncludeTax ? Number(item.total) : Number(item.total) + Number(item.total_tax)
    const qty = item.quantity
    const { net, vat } = vatFromGross(gross, rate)
    const unitNet = qty > 0 ? net / qty : 0

    totalNet += net
    totalVat += vat
    if (!vatByRate[rate]) vatByRate[rate] = { net: 0, vat: 0 }
    vatByRate[rate].net += net
    vatByRate[rate].vat += vat

    x = leftX
    doc.text(String(idx + 1), x, rowY, { width: col.nr }); x += col.nr
    const nameHeight = doc.heightOfString(item.name, { width: col.name, lineGap: 2 })
    doc.text(item.name, x, rowY, { width: col.name, lineGap: 2 }); x += col.name
    doc.text(String(-qty), x, rowY, { width: col.qty, align: 'right' }); x += col.qty
    doc.text(fmtMoney(unitNet), x, rowY, { width: col.unitPrice, align: 'right' }); x += col.unitPrice
    doc.text(`${rate}%`, x, rowY, { width: col.vatPct, align: 'right' }); x += col.vatPct
    doc.text(`-${fmtMoney(vat)}`, x, rowY, { width: col.vatAmt, align: 'right' }); x += col.vatAmt
    doc.text(`-${fmtMoney(gross)}`, x, rowY, { width: col.totalVat, align: 'right' })

    rowY += Math.max(15, nameHeight + 6)
    if (rowY > doc.page.height - 220) { doc.addPage(); rowY = 50 }
  }

  doc.moveTo(leftX, rowY + 2).lineTo(leftX + pageWidth, rowY + 2).lineWidth(0.5).stroke()
  renderTotals(doc, -totalNet, -totalVat, vatByRate, order, leftX, pageWidth, rowY, true)
}

// Partial/detailed refund: show refund line items
function generateRefundLinesTable(doc, refundedItems, leftX, pageWidth, pricesIncludeTax = false) {
  const col = { nr: 22, name: 180, qty: 35, unitPrice: 70, vatPct: 35, vatAmt: 60, totalVat: 0 }
  col.totalVat = pageWidth - col.nr - col.name - col.qty - col.unitPrice - col.vatPct - col.vatAmt

  const tableTop = doc.y
  doc.font(FONT_BOLD).fontSize(8)
  let x = leftX
  const headers = [
    ['Nr.', col.nr, 'left'],
    ['Pavadinimas', col.name, 'left'],
    ['Kiekis', col.qty, 'right'],
    ['Vnt. kaina\nbe PVM', col.unitPrice, 'right'],
    ['PVM %', col.vatPct, 'right'],
    ['PVM suma', col.vatAmt, 'right'],
    ['Suma su\nPVM', col.totalVat, 'right'],
  ]
  for (const [label, w, align] of headers) {
    doc.text(label, x, tableTop, { width: w, align })
    x += w
  }

  const headerBottom = tableTop + 22
  doc.moveTo(leftX, headerBottom).lineTo(leftX + pageWidth, headerBottom).lineWidth(0.5).stroke()

  doc.font(FONT).fontSize(8)
  let rowY = headerBottom + 5
  let totalNet = 0
  let totalVat = 0
  const vatByRate = {}

  for (let idx = 0; idx < refundedItems.length; idx++) {
    const item = refundedItems[idx]
    const rate = detectVatRate(item, pricesIncludeTax)
    // Refund amounts are negative in WC
    const gross = pricesIncludeTax
      ? Math.abs(Number(item.total))
      : Math.abs(Number(item.total) + Number(item.total_tax))
    const qty = Math.abs(item.quantity || 1)
    const { net, vat } = vatFromGross(gross, rate)
    const unitNet = qty > 0 ? net / qty : 0

    totalNet += net
    totalVat += vat
    if (!vatByRate[rate]) vatByRate[rate] = { net: 0, vat: 0 }
    vatByRate[rate].net += net
    vatByRate[rate].vat += vat

    x = leftX
    doc.text(String(idx + 1), x, rowY, { width: col.nr }); x += col.nr
    const nameHeight = doc.heightOfString(item.name, { width: col.name, lineGap: 2 })
    doc.text(item.name, x, rowY, { width: col.name, lineGap: 2 }); x += col.name
    doc.text(String(-qty), x, rowY, { width: col.qty, align: 'right' }); x += col.qty
    doc.text(fmtMoney(unitNet), x, rowY, { width: col.unitPrice, align: 'right' }); x += col.unitPrice
    doc.text(`${rate}%`, x, rowY, { width: col.vatPct, align: 'right' }); x += col.vatPct
    doc.text(`-${fmtMoney(vat)}`, x, rowY, { width: col.vatAmt, align: 'right' }); x += col.vatAmt
    doc.text(`-${fmtMoney(gross)}`, x, rowY, { width: col.totalVat, align: 'right' })

    rowY += Math.max(15, nameHeight + 6)
    if (rowY > doc.page.height - 220) { doc.addPage(); rowY = 50 }
  }

  doc.moveTo(leftX, rowY + 2).lineTo(leftX + pageWidth, rowY + 2).lineWidth(0.5).stroke()
  renderTotals(doc, -totalNet, -totalVat, vatByRate, null, leftX, pageWidth, rowY, true)
}

// Lump-sum refund when no line items available
function generateLumpSumRefund(doc, order, totalRefunded, leftX, pageWidth) {
  const { net, vat } = vatFromGross(totalRefunded)

  doc.font(FONT).fontSize(9)
  const totalsLabelX = leftX + pageWidth - 250
  const totalsValueX = totalsLabelX + 160
  const totalsW = 90
  let ty = doc.y + 10

  doc.text('Grąžinama suma be PVM:', totalsLabelX, ty, { width: 155, align: 'right' })
  doc.text(`-${fmtMoney(net)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
  ty += 16

  doc.text(`PVM ${DEFAULT_VAT_RATE}%:`, totalsLabelX, ty, { width: 155, align: 'right' })
  doc.text(`-${fmtMoney(vat)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
  ty += 18

  doc.font(FONT_BOLD).fontSize(11)
  doc.text('Viso grąžinama:', totalsLabelX, ty, { width: 155, align: 'right' })
  doc.text(`-${fmtMoney(totalRefunded)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
}

// Shared totals renderer for tables
function renderTotals(doc, totalNet, totalVat, vatByRate, order, leftX, pageWidth, rowY, isNegative) {
  const vatRates = Object.keys(vatByRate).sort((a, b) => Number(b) - Number(a))
  const totalsLines = 1 + vatRates.length + 2
  const estimatedHeight = totalsLines * 16 + 40
  if (rowY + estimatedHeight > doc.page.height - 50) {
    doc.addPage()
    rowY = 50
  }

  const totalsLabelX = leftX + pageWidth - 250
  const totalsValueX = totalsLabelX + 160
  const totalsW = 90
  let ty = rowY + 12
  doc.font(FONT).fontSize(9)

  doc.text('Prekių suma be PVM:', totalsLabelX, ty, { width: 155, align: 'right' })
  doc.text(`${fmtMoney(totalNet)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
  ty += 16

  // VAT breakdown per rate
  for (const rate of vatRates) {
    const r = vatByRate[rate]
    const vatAmount = isNegative ? -r.vat : r.vat
    doc.text(`PVM ${rate}%:`, totalsLabelX, ty, { width: 155, align: 'right' })
    doc.text(`${fmtMoney(vatAmount)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
    ty += 16
  }
  if (vatRates.length === 0) {
    doc.text(`PVM ${DEFAULT_VAT_RATE}%:`, totalsLabelX, ty, { width: 155, align: 'right' })
    doc.text(`${fmtMoney(totalVat)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
    ty += 16
  }
  ty += 2

  // Grand total
  const grandTotal = totalNet + totalVat
  doc.font(FONT_BOLD).fontSize(11)
  doc.text('Viso grąžinama:', totalsLabelX, ty, { width: 155, align: 'right' })
  doc.text(`${fmtMoney(grandTotal)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`Gaunami užsakymo #${orderId} duomenys...`)
  const order = await fetchOrder(orderId)

  // Validate that order has refunds
  const orderRefunds = order.refunds || []
  if (orderRefunds.length === 0) {
    console.error(`Klaida: užsakymas #${orderId} neturi grąžinimų. Kreditinė sąskaita nereikalinga.`)
    process.exit(1)
  }

  const totalRefunded = orderRefunds.reduce((s, r) => s + Math.abs(Number(r.total || r.amount)), 0)
  console.log(`Grąžinimų: ${orderRefunds.length}, viso: -${fmtMoney(totalRefunded)} EUR`)

  // Fetch detailed refund data (includes line items)
  console.log('Gaunami grąžinimų detalės...')
  const refunds = await fetchRefunds(orderId)

  const invoiceDir = join(homedir(), '.openclaw', 'invoices')
  if (!existsSync(invoiceDir)) {
    mkdirSync(invoiceDir, { recursive: true })
  }

  const outputPath = join(invoiceDir, `kreditine-${orderId}.pdf`)

  if (existsSync(outputPath)) {
    console.warn(`ĮSPĖJIMAS: kreditinė sąskaita ${outputPath} jau egzistuoja ir bus perrašyta.`)
  }

  console.log('Generuojama kreditinė PVM sąskaita faktūra...')
  await generateCreditNotePdf(order, refunds, outputPath)
  console.log(`Kreditinė sąskaita išsaugota: ${outputPath}`)
}

main().catch((err) => {
  console.error('Klaida generuojant kreditinę sąskaitą:', err.message)
  process.exit(1)
})
