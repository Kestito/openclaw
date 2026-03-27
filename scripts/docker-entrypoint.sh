#!/bin/sh
set -e

# Fix ownership on mounted volumes so the node user (uid 1000) can write.
# Host-mounted volumes may be owned by root.
OPENCLAW_DIR="${HOME}/.openclaw"
MCPORTER_DIR="${HOME}/.mcporter"

chown -R node:node "$OPENCLAW_DIR" 2>/dev/null || true
chown -R node:node "$MCPORTER_DIR" 2>/dev/null || true

# ── Invoice cron jobs ─────────────────────────────────────────────
# Set up cron jobs for automated invoice processing.
# Env vars (WOO_KEY, EMAIL_ADDRESS, etc.) are forwarded from the container.

CRON_ENV="$(printenv | grep -E '^(WOO_KEY|WOO_SECRET|EMAIL_ADDRESS|EMAIL_PASSWORD|IMAP_SERVER|NODE_TLS_REJECT_UNAUTHORIZED|HOME)=' | sed 's/"/\\"/g')"
CRON_FILE=/etc/cron.d/openclaw-invoices

cat > "$CRON_FILE" <<CRON
# Forwarded container env vars
${CRON_ENV}
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Send invoices for newly completed orders (every 4 hours)
0 */4 * * * node node /app/invoice-scripts/invoice-cron.mjs >> /tmp/invoice-cron.log 2>&1

# i.SAF invoice collection — 10th of each month at 08:00
0 8 10 * * node node /app/invoice-scripts/collect-invoices.mjs --send >> /tmp/isaf-cron.log 2>&1
CRON

chmod 0644 "$CRON_FILE"

# Start cron daemon in background (runs as root)
cron

# Drop privileges and exec the main process as the node user
exec gosu node "$@"
