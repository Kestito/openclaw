#!/usr/bin/env node

// Generate a Lithuanian PDF invoice (sąskaita faktūra) from a WooCommerce order.
// Compliant with LT VAT (PVM) invoice requirements.
//
// Usage: node generate-invoice.mjs <order_id>
// Requires env: WOO_KEY, WOO_SECRET
// Output: ~/.openclaw/invoices/saskaita-<order_id>.pdf

import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { request } from 'node:https'
import PDFDocument from 'pdfkit'

// ── Config ───────────────────────────────────────────────────────────
// Update these with your real company details.

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
const DEFAULT_VAT_RATE = 21 // LT standard PVM rate %

// DejaVu Sans supports Lithuanian diacritics (ą, č, ę, ė, į, š, ų, ū, ž)
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
const forceFlag = process.argv.includes('--force')
if (!orderId || !/^\d+$/.test(orderId)) {
  console.error('Naudojimas: node generate-invoice.mjs <užsakymo_id> [--force]')
  process.exit(1)
}

// Statuses that are allowed for invoice generation
const ALLOWED_STATUSES = ['completed', 'processing']
// Statuses that are explicitly blocked
const BLOCKED_STATUSES = ['cancelled', 'refunded', 'failed']

// ── Fetch order ──────────────────────────────────────────────────────

function fetchOrder(id) {
  const url = new URL(`/wp-json/wc/v3/orders/${id}`, STORE_URL)
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
  }).catch((err) => {
    console.error(`Klaida: nepavyko gauti užsakymo #${id}: ${err.message}`)
    process.exit(1)
  })
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

// Calculate VAT from gross (VAT-inclusive) amount.
function vatFromGross(gross, rate = DEFAULT_VAT_RATE) {
  const net = gross / (1 + rate / 100)
  const vat = gross - net
  return { net, vat, rate }
}

// Detect VAT rate from a WooCommerce line item's tax data.
// When prices_include_tax=true and WC has no tax config, taxes[] is empty
// and total_tax=0 — but VAT is still included in the price. Default to 21%.
function detectVatRate(item, pricesIncludeTax = false) {
  const taxes = item.taxes
  if (Array.isArray(taxes) && taxes.length > 0) {
    const tax = taxes[0]
    const totalTax = Number(tax.total)
    const subtotal = Number(tax.subtotal)
    const taxAmount = subtotal > 0 ? subtotal : totalTax
    const itemSubtotal = Number(item.subtotal)
    if (itemSubtotal > 0 && taxAmount > 0) {
      const computed = Math.round((taxAmount / itemSubtotal) * 100)
      if ([21, 9, 5, 0].includes(computed)) return computed
    }
  }
  // When prices include tax but WC doesn't separate it, VAT is still in the price
  if (pricesIncludeTax) return DEFAULT_VAT_RATE
  // Only return 0% when prices explicitly exclude tax and there's no tax applied
  if (Number(item.total_tax) === 0 && Number(item.total) > 0) return 0
  return DEFAULT_VAT_RATE
}

// ── PDF generation ───────────────────────────────────────────────────

function generatePdf(order, outputPath) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const stream = createWriteStream(outputPath)
  doc.pipe(stream)

  const leftX = 50
  const pageWidth = doc.page.width - 100

  // ── Header ─────────────────────────────────────────────────────────
  doc
    .fontSize(18)
    .font(FONT_BOLD)
    .text('PVM SĄSKAITA FAKTŪRA', { align: 'center' })
    .moveDown(0.2)

  doc
    .fontSize(11)
    .font(FONT)
    .text(`Serija B Nr. ${order.id}`, { align: 'center' })
    .moveDown(0.2)

  doc
    .fontSize(10)
    .text(`Išrašymo data: ${fmtDate(order.date_created)}`, { align: 'center' })
    .moveDown(1.2)

  // ── Seller / Buyer ─────────────────────────────────────────────────
  const rightX = 310
  const infoY = doc.y
  const lineH = 13

  // Seller
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

  // Buyer
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
  doc.moveDown(0.5)

  // ── Line items table ───────────────────────────────────────────────
  // Columns: Nr | Pavadinimas | Kiekis | Vnt. kaina be PVM | PVM % | PVM suma | Suma su PVM
  const tableTop = doc.y
  const col = {
    nr: 22,
    name: 180,
    qty: 35,
    unitPrice: 70,
    vatPct: 35,
    vatAmt: 60,
    totalVat: 0,
  }
  col.totalVat = pageWidth - col.nr - col.name - col.qty - col.unitPrice - col.vatPct - col.vatAmt

  // Header
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
  doc
    .moveTo(leftX, headerBottom)
    .lineTo(leftX + pageWidth, headerBottom)
    .lineWidth(0.5)
    .stroke()

  // Rows
  doc.font(FONT).fontSize(8)
  let rowY = headerBottom + 5

  // Back-calculate net + VAT using per-item tax rates from WooCommerce.
  const pricesIncludeTax = order.prices_include_tax
  let allItemsNet = 0
  let allItemsVat = 0
  const vatByRate = {} // { rate: { net, vat } }

  for (let idx = 0; idx < order.line_items.length; idx++) {
    const item = order.line_items[idx]
    const rate = detectVatRate(item, pricesIncludeTax)
    // When prices_include_tax=true, item.total already contains tax
    // When false, gross = total + total_tax
    const gross = pricesIncludeTax
      ? Number(item.total)
      : Number(item.total) + Number(item.total_tax)
    const qty = item.quantity
    const { net, vat } = vatFromGross(gross, rate)
    const unitNet = qty > 0 ? net / qty : 0

    allItemsNet += net
    allItemsVat += vat
    if (!vatByRate[rate]) vatByRate[rate] = { net: 0, vat: 0 }
    vatByRate[rate].net += net
    vatByRate[rate].vat += vat

    x = leftX
    doc.text(String(idx + 1), x, rowY, { width: col.nr })
    x += col.nr
    const nameHeight = doc.heightOfString(item.name, { width: col.name, lineGap: 2 })
    doc.text(item.name, x, rowY, { width: col.name, lineGap: 2 })
    x += col.name
    doc.text(String(qty), x, rowY, { width: col.qty, align: 'right' })
    x += col.qty
    doc.text(`${fmtMoney(unitNet)}`, x, rowY, { width: col.unitPrice, align: 'right' })
    x += col.unitPrice
    doc.text(`${rate}%`, x, rowY, { width: col.vatPct, align: 'right' })
    x += col.vatPct
    doc.text(fmtMoney(vat), x, rowY, { width: col.vatAmt, align: 'right' })
    x += col.vatAmt
    doc.text(fmtMoney(gross), x, rowY, { width: col.totalVat, align: 'right' })

    rowY += Math.max(15, nameHeight + 6)
    if (rowY > doc.page.height - 220) {
      doc.addPage()
      rowY = 50
    }
  }

  // ── Shipping as line item ─────────────────────────────────────────
  const shippingGross = pricesIncludeTax
    ? Number(order.shipping_total)
    : Number(order.shipping_total) + Number(order.shipping_tax)
  let shippingVatRate = DEFAULT_VAT_RATE
  let shippingNetCalc = 0
  let shippingVatCalc = 0

  if (shippingGross > 0) {
    // Detect shipping VAT rate
    const shippingLine = (order.shipping_lines || [])[0]
    if (shippingLine && !pricesIncludeTax) {
      const shippingTaxes = shippingLine.taxes
      if (Array.isArray(shippingTaxes) && shippingTaxes.length > 0) {
        const sTax = Number(shippingTaxes[0].total)
        const sNet = Number(shippingLine.total)
        if (sNet > 0 && sTax > 0) {
          const computedRate = Math.round((sTax / sNet) * 100)
          if ([21, 9, 5, 0].includes(computedRate)) shippingVatRate = computedRate
        }
      }
    }
    const sv = vatFromGross(shippingGross, shippingVatRate)
    shippingNetCalc = sv.net
    shippingVatCalc = sv.vat

    // Add to VAT tracking
    if (!vatByRate[shippingVatRate]) vatByRate[shippingVatRate] = { net: 0, vat: 0 }
    vatByRate[shippingVatRate].net += shippingNetCalc
    vatByRate[shippingVatRate].vat += shippingVatCalc

    const shippingName = shippingLine?.method_title || 'Pristatymas'
    const itemNum = order.line_items.length + 1

    x = leftX
    doc.text(String(itemNum), x, rowY, { width: col.nr }); x += col.nr
    doc.text(shippingName, x, rowY, { width: col.name }); x += col.name
    doc.text('1', x, rowY, { width: col.qty, align: 'right' }); x += col.qty
    doc.text(fmtMoney(shippingNetCalc), x, rowY, { width: col.unitPrice, align: 'right' }); x += col.unitPrice
    doc.text(`${shippingVatRate}%`, x, rowY, { width: col.vatPct, align: 'right' }); x += col.vatPct
    doc.text(fmtMoney(shippingVatCalc), x, rowY, { width: col.vatAmt, align: 'right' }); x += col.vatAmt
    doc.text(fmtMoney(shippingGross), x, rowY, { width: col.totalVat, align: 'right' })
    rowY += 15
  }

  // Bottom line
  doc
    .moveTo(leftX, rowY + 2)
    .lineTo(leftX + pageWidth, rowY + 2)
    .lineWidth(0.5)
    .stroke()

  // ── Totals ─────────────────────────────────────────────────────────
  const vatRates = Object.keys(vatByRate).sort((a, b) => Number(b) - Number(a))
  const hasDiscount = Number(order.discount_total) > 0
  const totalsLines = 1 + (hasDiscount ? 1 : 0) + vatRates.length + 1 + 2
  const estimatedTotalsHeight = totalsLines * 16 + 40
  if (rowY + estimatedTotalsHeight > doc.page.height - 50) {
    doc.addPage()
    rowY = 50
  }

  const totalsLabelX = leftX + pageWidth - 250
  const totalsValueX = totalsLabelX + 160
  const totalsW = 90
  let ty = rowY + 12
  doc.font(FONT).fontSize(9)

  // Subtotal without VAT (all items + shipping)
  const totalNet = allItemsNet + shippingNetCalc
  doc.text('Suma be PVM:', totalsLabelX, ty, { width: 155, align: 'right' })
  doc.text(`${fmtMoney(totalNet)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
  ty += 16

  // Discount
  const discountTotal = Number(order.discount_total) || 0
  if (discountTotal > 0) {
    doc.text('Nuolaida:', totalsLabelX, ty, { width: 155, align: 'right' })
    doc.text(`-${fmtMoney(discountTotal)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
    ty += 16
  }

  // VAT breakdown per rate (shipping VAT already included in vatByRate)
  const totalVatCalc = allItemsVat + shippingVatCalc
  for (const rate of vatRates) {
    const r = vatByRate[rate]
    if (r.vat > 0) {
      doc.text(`PVM ${rate}%:`, totalsLabelX, ty, { width: 155, align: 'right' })
      doc.text(`${fmtMoney(r.vat)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
      ty += 16
    }
  }
  if (vatRates.length === 0) {
    doc.text(`PVM ${DEFAULT_VAT_RATE}%:`, totalsLabelX, ty, { width: 155, align: 'right' })
    doc.text(`${fmtMoney(totalVatCalc)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
    ty += 16
  }
  ty += 2

  // Grand total
  doc.font(FONT_BOLD)
  doc.fontSize(11)
  doc.text('Viso mokėti:', totalsLabelX, ty, { width: 155, align: 'right' })
  doc.text(`${fmtMoney(order.total)} EUR`, totalsValueX, ty, { width: totalsW, align: 'right' })
  ty += 28

  // ── Footer ──────────────────────────────────────────────────────────
  doc.fontSize(8).fillColor('#666666')
  doc.text('Sąskaita faktūra galioja be parašo ir antspaudo (LR buhalterinės apskaitos įstatymas, 13 str. 1 d.)', leftX, ty, { align: 'center', width: pageWidth })
  doc.fillColor('#000000') // reset fill color

  doc.end()

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve)
    stream.on('error', reject)
  })
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`Gaunami užsakymo #${orderId} duomenys...`)
  const order = await fetchOrder(orderId)

  // ── Status validation ───────────────────────────────────────────────
  const status = order.status
  if (BLOCKED_STATUSES.includes(status)) {
    console.error(`Klaida: užsakymas #${orderId} turi statusą "${status}" — sąskaita negali būti generuojama.`)
    if (!forceFlag) {
      console.error('Naudokite --force jei tikrai norite generuoti.')
      process.exit(1)
    }
    console.warn(`ĮSPĖJIMAS: generuojama sąskaita su statusu "${status}" (--force).`)
  } else if (!ALLOWED_STATUSES.includes(status) && !forceFlag) {
    console.error(`ĮSPĖJIMAS: užsakymas #${orderId} turi statusą "${status}" (laukiama: ${ALLOWED_STATUSES.join(', ')}).`)
    console.error('Naudokite --force jei tikrai norite generuoti.')
    process.exit(1)
  }

  // ── Empty line items check ──────────────────────────────────────────
  if (!order.line_items || order.line_items.length === 0) {
    console.error(`Klaida: užsakymas #${orderId} neturi prekių eilučių.`)
    process.exit(1)
  }

  // ── Billing info check ──────────────────────────────────────────────
  const buyerName = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ')
  if (!buyerName) {
    console.warn(`ĮSPĖJIMAS: užsakymas #${orderId} neturi pirkėjo vardo/pavardės.`)
  }

  // ── Refund handling ─────────────────────────────────────────────────
  const refunds = order.refunds || []
  const totalRefunded = refunds.reduce((sum, r) => sum + Math.abs(Number(r.total)), 0)
  if (totalRefunded > 0) {
    console.warn(`ĮSPĖJIMAS: užsakymas #${orderId} turi grąžinimų: -${fmtMoney(totalRefunded)} EUR.`)
    if (totalRefunded >= Number(order.total) + totalRefunded) {
      console.error('Užsakymas pilnai grąžintas — sąskaita nebus generuojama.')
      if (!forceFlag) process.exit(1)
    }
  }

  const invoiceDir = join(homedir(), '.openclaw', 'invoices')
  if (!existsSync(invoiceDir)) {
    mkdirSync(invoiceDir, { recursive: true })
  }

  const outputPath = join(invoiceDir, `saskaita-${orderId}.pdf`)

  // ── Overwrite warning ───────────────────────────────────────────────
  if (existsSync(outputPath)) {
    console.warn(`ĮSPĖJIMAS: sąskaita ${outputPath} jau egzistuoja ir bus perrašyta.`)
  }

  console.log('Generuojama PVM saskaita faktura...')
  await generatePdf(order, outputPath)
  console.log(`Saskaita issaugota: ${outputPath}`)
}

main().catch((err) => {
  console.error('Klaida generuojant saskaita:', err.message)
  process.exit(1)
})
