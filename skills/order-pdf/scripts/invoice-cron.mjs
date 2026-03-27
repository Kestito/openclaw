#!/usr/bin/env node

// Cron job: fetch completed WooCommerce orders from the last 72h,
// generate PDF invoices, create Gmail draft emails to each customer.
//
// Uses IMAP (Gmail app password) to save drafts — no OAuth needed.
//
// Usage: node invoice-cron.mjs
// Requires env: WOO_KEY, WOO_SECRET, EMAIL_ADDRESS, EMAIL_PASSWORD, IMAP_SERVER

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { request as httpsRequest } from 'node:https'
import Imap from 'imap'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const STORE_URL = 'https://www.liuti.lt'
const INVOICE_DIR = join(homedir(), '.openclaw', 'invoices')
const PROCESSED_DIR = join(INVOICE_DIR, '.processed')
const HOURS_BACK = 72

const WOO_KEY = process.env.WOO_KEY
const WOO_SECRET = process.env.WOO_SECRET
const EMAIL_ADDRESS = process.env.EMAIL_ADDRESS
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD
const IMAP_SERVER = process.env.IMAP_SERVER || 'imap.gmail.com'

if (!WOO_KEY || !WOO_SECRET) {
  console.error('Klaida: WOO_KEY ir WOO_SECRET privalomi.')
  process.exit(1)
}

if (!EMAIL_ADDRESS || !EMAIL_PASSWORD) {
  console.error('Klaida: EMAIL_ADDRESS ir EMAIL_PASSWORD privalomi.')
  process.exit(1)
}

mkdirSync(INVOICE_DIR, { recursive: true })
mkdirSync(PROCESSED_DIR, { recursive: true })

// ── Fetch recent orders (with pagination) ───────────────────────────

function httpGet(url) {
  const auth = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64')
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 30_000,
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        try {
          const totalPages = Number(res.headers['x-wp-totalpages']) || 1
          resolve({ body: JSON.parse(data), totalPages })
        } catch { reject(new Error('Netinkamas JSON')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.end()
  })
}

async function fetchRecentOrders() {
  const since = new Date(Date.now() - HOURS_BACK * 3600_000).toISOString()
  const allOrders = []
  let page = 1

  try {
    while (true) {
      const url = new URL(`/wp-json/wc/v3/orders`, STORE_URL)
      url.searchParams.set('after', since)
      url.searchParams.set('per_page', '100')
      url.searchParams.set('orderby', 'date')
      url.searchParams.set('order', 'desc')
      url.searchParams.set('page', String(page))

      const { body, totalPages } = await httpGet(url)
      allOrders.push(...body)
      if (page >= totalPages) break
      page++
    }
  } catch (err) {
    console.error(`Klaida gaunant užsakymus (psl. ${page}): ${err.message}`)
  }

  return allOrders
}

function isProcessed(orderId) {
  return existsSync(join(PROCESSED_DIR, `${orderId}.done`))
}

function markProcessed(orderId) {
  writeFileSync(join(PROCESSED_DIR, `${orderId}.done`), new Date().toISOString())
}

// ── Generate invoice / credit note ───────────────────────────────────

function generateInvoice(orderId) {
  const scriptPath = join(__dirname, 'generate-invoice.mjs')
  try {
    execSync(`node "${scriptPath}" ${orderId}`, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: 'inherit',
    })
    return join(INVOICE_DIR, `saskaita-${orderId}.pdf`)
  } catch {
    console.error(`Klaida generuojant sąskaitą užsakymui #${orderId}`)
    return null
  }
}

function generateCreditNote(orderId) {
  const scriptPath = join(__dirname, 'generate-credit-note.mjs')
  try {
    execSync(`node "${scriptPath}" ${orderId}`, {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: 'inherit',
    })
    return join(INVOICE_DIR, `kreditine-${orderId}.pdf`)
  } catch {
    console.error(`Klaida generuojant kreditinę sąskaitą užsakymui #${orderId}`)
    return null
  }
}

function isCreditNoteProcessed(orderId) {
  return existsSync(join(PROCESSED_DIR, `${orderId}.credit.done`))
}

function markCreditNoteProcessed(orderId) {
  writeFileSync(join(PROCESSED_DIR, `${orderId}.credit.done`), new Date().toISOString())
}

// ── Build MIME message and save as IMAP draft ────────────────────────

// ── HTML email template (matches WooCommerce / Liuti Kids branding) ────

const LOGO_URL = 'https://nuy.soundestlink.com/image/newsletter/61405a077c36a9001f89edf4'
const STORE_LINK = 'https://www.liuti.lt'

function buildInvoiceHtml(order, orderId, customerName) {
  const orderDate = new Date(order.date_created).toLocaleDateString('lt-LT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Liuti Kids</title>
<style type="text/css">
html,body{width:100%!important;height:100%!important;margin:0 auto!important;padding:0!important;-webkit-font-smoothing:antialiased;}
table{border-collapse:collapse;}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
@media screen and (max-width:600px){
  .mobile-container{width:100%!important;display:table!important;}
  .mobile-table{width:100%!important;}
  .padding-left{padding-left:12px!important;}
  .padding-right{padding-right:12px!important;}
}
</style>
</head>
<body style="padding:0;margin:0;">
<table border="0" cellpadding="0" cellspacing="0" width="100%" height="100%"
  style="background-color:#EDEEF0;" class="mobile-body-container"><tr><td>
<table border="0" cellpadding="0" cellspacing="0" width="100%"
  style="min-width:290px;"><tr><td>
<table width="600" border="0" cellpadding="0" cellspacing="0" align="center"
  style="width:600px;margin:0 auto;background-color:#FFFFFF;" class="mobile-container"><tr><td>
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td>

<!-- Logo -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  class="padding-left padding-right"
  style="padding:24px;background-color:#FFFFFF;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td align="center"
  style="padding:12px;">
<a target="_blank" href="${STORE_LINK}">
  <img width="140" alt="Liuti Kids" border="0" src="${LOGO_URL}"
    style="max-width:140px!important;height:auto;margin:0;vertical-align:middle;font-family:Arial,sans-serif;font-size:12px;color:#000000;line-height:1.5;" />
</a>
</td></tr></table>
</td></tr></table>

<!-- Nav menu + divider -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"
  style="background-color:#FFFFFF;"><tr><td
  class="padding-left padding-right"
  style="padding-left:24px;padding-right:24px;padding-top:0;padding-bottom:12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%" align="center"
  style="text-align:center;"><tr>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/lauko-apranga/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">Lauko apranga</a>
</td>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/batai-vaikams/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">Batai</a>
</td>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/lavinamieji-zaislai/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">\u017daislai</a>
</td>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/ispardavimas/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">Išpardavimas</a>
</td>
</tr></table>
<!-- Black divider line -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="padding:6px 12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="font-size:0;line-height:0;border-top:1px solid #000000;">&nbsp;</td></tr></table>
</td></tr></table>
</td></tr></table>

<!-- Heading -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  class="padding-left padding-right"
  style="padding-left:24px;padding-right:24px;padding-top:24px;padding-bottom:12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="color:#000000;font-family:Arial,sans-serif;font-size:36px;line-height:1.25;padding:12px;">
<p style="margin:0;"><strong>PVM s\u0105skaita fakt\u016bra</strong></p>
</td></tr></table>
<!-- Body text -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="color:#000000;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;padding:12px;">
<p style="margin:0 0 12px;">Sveiki${customerName ? `, ${customerName}` : ''},</p>
<p style="margin:0 0 12px;">D\u0117kojame u\u017e Jūsų u\u017esakym\u0105. Siun\u010diame PVM s\u0105skait\u0105 fakt\u016br\u0105, kuri prid\u0117ta kaip PDF failas.</p>
<p style="margin:0 0 12px;"></p>
</td></tr></table>
<!-- Order info box -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"
  style="margin:0 12px;"><tr><td
  style="background-color:#F7F7F7;padding:20px 24px;font-family:Arial,sans-serif;">
<table border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr><td style="color:#383838;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:12px;border-bottom:1px solid #E0E0E0;">
    U\u017esakymo informacija
  </td></tr>
  <tr><td style="padding-top:12px;padding-bottom:6px;">
    <span style="color:#888;font-size:13px;">U\u017esakymo nr.:</span>
    <span style="color:#000000;font-size:14px;font-weight:bold;"> ${orderId}</span>
  </td></tr>
  <tr><td style="padding-bottom:6px;">
    <span style="color:#888;font-size:13px;">Data:</span>
    <span style="color:#000000;font-size:14px;"> ${orderDate}</span>
  </td></tr>
  <tr><td style="padding-top:8px;border-top:1px solid #E0E0E0;">
    <span style="color:#888;font-size:13px;">Suma:</span>
    <span style="color:#000000;font-size:20px;font-weight:bold;"> ${Number(order.total).toFixed(2)} EUR</span>
  </td></tr>
</table>
</td></tr></table>
<!-- CTA Button -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"
  style="table-layout:fixed;"><tr><td align="center"
  style="padding:24px 12px;" valign="top">
<table border="0" cellpadding="0" cellspacing="0"
  style="background-color:#00A3FF;border-radius:0px;border-collapse:separate;"><tr>
<td align="center" valign="middle"
  style="font-family:Arial,sans-serif;font-size:16px;color:#FFFFFF;">
<a target="_blank" href="${STORE_LINK}"
  style="text-decoration:none;padding:16px;display:inline-block;font-family:Arial,sans-serif;font-size:16px;color:#FFFFFF;line-height:1.2;">Liuti Kids</a>
</td></tr></table>
</td></tr></table>
<!-- Divider -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="padding:6px 12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="font-size:0;line-height:0;border-top:1px solid #000000;">&nbsp;</td></tr></table>
</td></tr></table>
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td align="center"
  style="color:#888;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;padding:12px;">
<p style="margin:0;">PDF s\u0105skaita fakt\u016bra prid\u0117ta prie \u0161io lai\u0161ko.</p>
</td></tr></table>
</td></tr></table>

<!-- Footer -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  class="padding-left padding-right"
  style="padding:24px;background-color:#000000;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;padding:12px;">
<p style="margin:0 0 8px;">\u00a9 Li\u016bti Kids / MB Bajora</p>
<p style="margin:0;">
  <a href="${STORE_LINK}" target="_blank"
    style="color:#00A3FF;text-decoration:none;">www.liuti.lt</a>
</p>
</td></tr></table>
</td></tr></table>

</td></tr></table>
</td></tr></table>
</td></tr></table>
</td></tr></table>
</body>
</html>`
}

function buildCreditNoteHtml(order, orderId, customerName, refundTotal) {
  const orderDate = new Date(order.date_created).toLocaleDateString('lt-LT', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Liuti Kids</title>
<style type="text/css">
html,body{width:100%!important;height:100%!important;margin:0 auto!important;padding:0!important;-webkit-font-smoothing:antialiased;}
table{border-collapse:collapse;}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
@media screen and (max-width:600px){
  .mobile-container{width:100%!important;display:table!important;}
  .mobile-table{width:100%!important;}
  .padding-left{padding-left:12px!important;}
  .padding-right{padding-right:12px!important;}
}
</style>
</head>
<body style="padding:0;margin:0;">
<table border="0" cellpadding="0" cellspacing="0" width="100%" height="100%"
  style="background-color:#EDEEF0;" class="mobile-body-container"><tr><td>
<table border="0" cellpadding="0" cellspacing="0" width="100%"
  style="min-width:290px;"><tr><td>
<table width="600" border="0" cellpadding="0" cellspacing="0" align="center"
  style="width:600px;margin:0 auto;background-color:#FFFFFF;" class="mobile-container"><tr><td>
<table width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td>

<!-- Logo -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  class="padding-left padding-right"
  style="padding:24px;background-color:#FFFFFF;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td align="center"
  style="padding:12px;">
<a target="_blank" href="${STORE_LINK}">
  <img width="140" alt="Liuti Kids" border="0" src="${LOGO_URL}"
    style="max-width:140px!important;height:auto;margin:0;vertical-align:middle;font-family:Arial,sans-serif;font-size:12px;color:#000000;line-height:1.5;" />
</a>
</td></tr></table>
</td></tr></table>

<!-- Nav menu + divider -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"
  style="background-color:#FFFFFF;"><tr><td
  class="padding-left padding-right"
  style="padding-left:24px;padding-right:24px;padding-top:0;padding-bottom:12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%" align="center"
  style="text-align:center;"><tr>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/lauko-apranga/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">Lauko apranga</a>
</td>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/batai-vaikams/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">Batai</a>
</td>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/lavinamieji-zaislai/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">\u017daislai</a>
</td>
<td align="center" style="vertical-align:middle;padding:12px;" valign="middle">
  <a href="${STORE_LINK}/ispardavimas/" target="_blank"
    style="color:#383838;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;">Išpardavimas</a>
</td>
</tr></table>
<!-- Black divider line -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="padding:6px 12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="font-size:0;line-height:0;border-top:1px solid #000000;">&nbsp;</td></tr></table>
</td></tr></table>
</td></tr></table>

<!-- Heading -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  class="padding-left padding-right"
  style="padding-left:24px;padding-right:24px;padding-top:24px;padding-bottom:12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="color:#000000;font-family:Arial,sans-serif;font-size:36px;line-height:1.25;padding:12px;">
<p style="margin:0;"><strong>Kreditin\u0117 s\u0105skaita fakt\u016bra</strong></p>
</td></tr></table>
<!-- Body text -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="color:#000000;font-family:Arial,sans-serif;font-size:14px;line-height:1.5;padding:12px;">
<p style="margin:0 0 12px;">Sveiki${customerName ? `, ${customerName}` : ''},</p>
<p style="margin:0 0 12px;">Siun\u010diame Jums kreditin\u0119 PVM s\u0105skait\u0105 fakt\u016br\u0105 pagal u\u017esakym\u0105 Nr. ${orderId}.</p>
<p style="margin:0 0 12px;"></p>
</td></tr></table>
<!-- Refund info box -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"
  style="margin:0 12px;"><tr><td
  style="background-color:#F7F7F7;padding:20px 24px;font-family:Arial,sans-serif;">
<table border="0" cellspacing="0" cellpadding="0" width="100%">
  <tr><td style="color:#383838;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;padding-bottom:12px;border-bottom:1px solid #E0E0E0;">
    Gr\u0105\u017einimo informacija
  </td></tr>
  <tr><td style="padding-top:12px;padding-bottom:6px;">
    <span style="color:#888;font-size:13px;">U\u017esakymo nr.:</span>
    <span style="color:#000000;font-size:14px;font-weight:bold;"> ${orderId}</span>
  </td></tr>
  <tr><td style="padding-bottom:6px;">
    <span style="color:#888;font-size:13px;">U\u017esakymo data:</span>
    <span style="color:#000000;font-size:14px;"> ${orderDate}</span>
  </td></tr>
  <tr><td style="padding-top:8px;border-top:1px solid #E0E0E0;">
    <span style="color:#888;font-size:13px;">Gr\u0105\u017einama suma:</span>
    <span style="color:#000000;font-size:20px;font-weight:bold;"> -${refundTotal.toFixed(2)} EUR</span>
  </td></tr>
</table>
</td></tr></table>
<!-- CTA Button -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"
  style="table-layout:fixed;"><tr><td align="center"
  style="padding:24px 12px;" valign="top">
<table border="0" cellpadding="0" cellspacing="0"
  style="background-color:#00A3FF;border-radius:0px;border-collapse:separate;"><tr>
<td align="center" valign="middle"
  style="font-family:Arial,sans-serif;font-size:16px;color:#FFFFFF;">
<a target="_blank" href="${STORE_LINK}"
  style="text-decoration:none;padding:16px;display:inline-block;font-family:Arial,sans-serif;font-size:16px;color:#FFFFFF;line-height:1.2;">Liuti Kids</a>
</td></tr></table>
</td></tr></table>
<!-- Divider -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="padding:6px 12px;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="font-size:0;line-height:0;border-top:1px solid #000000;">&nbsp;</td></tr></table>
</td></tr></table>
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td align="center"
  style="color:#888;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;padding:12px;">
<p style="margin:0;">PDF kreditin\u0117 s\u0105skaita fakt\u016bra prid\u0117ta prie \u0161io lai\u0161ko.</p>
</td></tr></table>
</td></tr></table>

<!-- Footer -->
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  class="padding-left padding-right"
  style="padding:24px;background-color:#000000;">
<table border="0" cellspacing="0" cellpadding="0" width="100%"><tr><td
  style="color:#FFFFFF;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;padding:12px;">
<p style="margin:0 0 8px;">\u00a9 Li\u016bti Kids / MB Bajora</p>
<p style="margin:0;">
  <a href="${STORE_LINK}" target="_blank"
    style="color:#00A3FF;text-decoration:none;">www.liuti.lt</a>
</p>
</td></tr></table>
</td></tr></table>

</td></tr></table>
</td></tr></table>
</td></tr></table>
</td></tr></table>
</body>
</html>`
}

function buildMimeMessage(order, pdfPath, { isCreditNote = false } = {}) {
  const customerEmail = order.billing.email
  const customerName = [order.billing.first_name, order.billing.last_name]
    .filter(Boolean)
    .join(' ')
  const orderId = order.id

  const pdfBase64 = readFileSync(pdfPath).toString('base64')
  const filename = isCreditNote ? `kreditine-${orderId}.pdf` : `saskaita-${orderId}.pdf`

  const subject = isCreditNote
    ? `Kreditinė PVM sąskaita faktūra Nr. ${orderId} - liuti.lt`
    : `PVM sąskaita faktūra Nr. ${orderId} - liuti.lt`

  const refundTotal = (order.refunds || []).reduce((s, r) => s + Math.abs(Number(r.total)), 0)

  const textBody = isCreditNote
    ? [
        `Sveiki ${customerName || 'Gerbiamas kliente'},`,
        ``,
        `Siunčiame Jūsų užsakymo Nr. ${orderId} kreditinę PVM sąskaitą faktūrą.`,
        `Kreditinė sąskaita pridėta kaip PDF failas.`,
        ``,
        `Grąžinama suma: -${refundTotal.toFixed(2)} EUR`,
        ``,
        `Pagarbiai,`,
        `Liūti Kids`,
        `liuti.lt`,
      ].join('\r\n')
    : [
        `Sveiki ${customerName || 'Gerbiamas kliente'},`,
        ``,
        `Siunčiame Jūsų užsakymo Nr. ${orderId} PVM sąskaitą faktūrą.`,
        `Sąskaita pridėta kaip PDF failas.`,
        ``,
        `Suma: ${Number(order.total).toFixed(2)} EUR`,
        ``,
        `Pagarbiai,`,
        `Liūti Kids`,
        `liuti.lt`,
      ].join('\r\n')

  const htmlBody = isCreditNote
    ? buildCreditNoteHtml(order, orderId, customerName, refundTotal)
    : buildInvoiceHtml(order, orderId, customerName)

  const mixedBoundary = `----=_Mixed_${Date.now()}`
  const altBoundary = `----=_Alt_${Date.now()}`

  const mime = [
    `From: MB Bajora / Liuti Kids <${EMAIL_ADDRESS}>`,
    `To: ${customerName} <${customerEmail}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    `Date: ${new Date().toUTCString()}`,
    ``,
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    ``,
    `--${altBoundary}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(textBody).toString('base64'),
    `--${altBoundary}`,
    `Content-Type: text/html; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    Buffer.from(htmlBody).toString('base64'),
    `--${altBoundary}--`,
    `--${mixedBoundary}`,
    `Content-Type: application/pdf; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    pdfBase64,
    `--${mixedBoundary}--`,
    ``,
  ].join('\r\n')

  return mime
}

function sendEmailViaSMTP(mimeMessage) {
  const nodemailer = require('nodemailer')
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: { user: EMAIL_ADDRESS, pass: EMAIL_PASSWORD },
    tls: { rejectUnauthorized: false },
  })

  return transporter.sendMail({
    envelope: {
      from: EMAIL_ADDRESS,
      to: mimeMessage.match(/^To:.*<(.+?)>/m)?.[1] || mimeMessage.match(/^To:\s*(.+)$/m)?.[1],
    },
    raw: mimeMessage,
  })
}

// ── WooCommerce: add order note ──────────────────────────────────────

function addOrderNote(orderId, note) {
  const url = new URL(`/wp-json/wc/v3/orders/${orderId}/notes`, STORE_URL)
  const auth = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString('base64')
  const body = JSON.stringify({ note })

  return new Promise((resolve) => {
    const req = httpsRequest(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15_000,
    }, (res) => {
      res.resume() // drain
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log(`  Užsakymo pastaba pridėta: #${orderId}`)
      } else {
        console.error(`  Klaida pridedant pastabą užsakymui #${orderId} (HTTP ${res.statusCode})`)
      }
      resolve()
    })
    req.on('error', () => {
      console.error(`  Klaida pridedant pastabą užsakymui #${orderId}`)
      resolve()
    })
    req.on('timeout', () => { req.destroy(); resolve() })
    req.write(body)
    req.end()
  })
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Sąskaitų cron: tikrinam užsakymus per paskutines ${HOURS_BACK}h ===`)

  const orders = await fetchRecentOrders()
  console.log(`Rasta užsakymų: ${orders.length}`)

  // ── Auto-generate credit notes for refunded invoiced orders ────────
  const refundedInvoiced = orders.filter(
    (o) => (o.status === 'refunded' || o.status === 'cancelled')
      && isProcessed(o.id)
      && !isCreditNoteProcessed(o.id)
      && (o.refunds || []).length > 0,
  )
  if (refundedInvoiced.length > 0) {
    console.log(`\n=== Kreditinės sąskaitos: ${refundedInvoiced.length} ===`)
    for (const o of refundedInvoiced) {
      const refundTotal = (o.refunds || []).reduce((s, r) => s + Math.abs(Number(r.total)), 0)
      const customerEmail = o.billing?.email
      console.log(`  #${o.id} [${o.status}] grąžinta: ${refundTotal.toFixed(2)} EUR`)

      // Generate credit note PDF
      const creditPath = generateCreditNote(o.id)
      if (!creditPath) {
        console.error(`  #${o.id}: nepavyko sugeneruoti kreditinės sąskaitos.`)
        markCreditNoteProcessed(o.id)
        continue
      }

      // Create email draft if customer has email
      if (customerEmail) {
        try {
          const mime = buildMimeMessage(o, creditPath, { isCreditNote: true })
          await sendEmailViaSMTP(mime)
          console.log(`  Kreditinės laiškas išsiųstas: #${o.id} → ${customerEmail}`)
          await addOrderNote(o.id, `Kreditinė PVM sąskaita faktūra sugeneruota ir laiškas išsiųstas → ${customerEmail}`)
        } catch (err) {
          console.error(`  Klaida kuriant kreditinės laišką #${o.id}: ${err.message}`)
        }
      }
      markCreditNoteProcessed(o.id)
    }
    console.log('')
  }

  const toProcess = orders.filter(
    (o) => o.status === 'completed' && !isProcessed(o.id),
  )

  // Skip orders with no line items or fully refunded
  const validOrders = toProcess.filter((o) => {
    if (!o.line_items || o.line_items.length === 0) {
      console.log(`  #${o.id}: nėra prekių eilučių, praleidžiama.`)
      markProcessed(o.id)
      return false
    }
    const refundTotal = (o.refunds || []).reduce((s, r) => s + Math.abs(Number(r.total)), 0)
    if (refundTotal > 0 && refundTotal >= Number(o.total) + refundTotal) {
      console.log(`  #${o.id}: pilnai grąžintas, praleidžiama.`)
      markProcessed(o.id)
      return false
    }
    return true
  })

  console.log(`Nauji įvykdyti užsakymai: ${validOrders.length}`)

  if (validOrders.length === 0) {
    console.log('Nėra naujų užsakymų apdorojimui.')
    return
  }

  let successCount = 0

  for (const order of validOrders) {
    const orderId = order.id
    const customerEmail = order.billing?.email

    if (!customerEmail) {
      console.log(`  #${orderId}: nėra kliento el. pašto, praleidžiama.`)
      markProcessed(orderId)
      continue
    }

    // Skip if buyer has no name (likely test/invalid order)
    const buyerName = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ')
    if (!buyerName) {
      console.warn(`  #${orderId}: nėra pirkėjo vardo, praleidžiama.`)
      markProcessed(orderId)
      continue
    }

    console.log(`\n  Apdorojamas #${orderId} → ${customerEmail}...`)

    // Warn about partial refunds
    const refunds = order.refunds || []
    const refundTotal = refunds.reduce((s, r) => s + Math.abs(Number(r.total)), 0)
    if (refundTotal > 0) {
      console.warn(`  ĮSPĖJIMAS: #${orderId} turi dalinį grąžinimą: -${refundTotal.toFixed(2)} EUR`)
    }

    // 1. Generate PDF
    const pdfPath = generateInvoice(orderId)
    if (!pdfPath) {
      console.error(`  #${orderId}: nepavyko sugeneruoti PDF, praleidžiama.`)
      markProcessed(orderId) // prevent infinite retries
      continue
    }

    // 2. Build MIME and save as draft
    try {
      const mime = buildMimeMessage(order, pdfPath)
      await sendEmailViaSMTP(mime)
      console.log(`  Juodraštis sukurtas: #${orderId} → ${customerEmail}`)
      await addOrderNote(orderId, `PVM sąskaita faktūra sugeneruota ir laiškas išsiųstas → ${customerEmail}`)
      markProcessed(orderId)
      successCount++
    } catch (err) {
      console.error(`  Klaida kuriant laišką #${orderId}: ${err.message}`)
    }
  }

  console.log(`\n=== Baigta. Apdorota: ${successCount}/${validOrders.length} ===`)
}

main().catch((err) => {
  console.error('Klaida:', err.message)
  process.exit(1)
})
