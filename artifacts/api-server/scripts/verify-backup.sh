#!/usr/bin/env bash
set -euo pipefail

HEALTHZ_URL="${APP_BASE_URL:-http://localhost:${PORT:-3001}}/healthz"
MAX_RETRIES=5
RETRY_DELAY=3

echo "=== AI Gateway — Backup Verification ==="
echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# ─── 1. Health check ────────────────────────────────────────────────────────

echo "[1/4] Health check: $HEALTHZ_URL"
for i in $(seq 1 $MAX_RETRIES); do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTHZ_URL" || true)
  if [ "$HTTP_STATUS" = "200" ]; then
    echo "  OK — server is up (HTTP 200)"
    break
  fi
  if [ "$i" = "$MAX_RETRIES" ]; then
    echo "  FAIL — server did not respond after $MAX_RETRIES attempts (last status: $HTTP_STATUS)"
    exit 1
  fi
  echo "  attempt $i/$MAX_RETRIES failed (status: $HTTP_STATUS), retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done

# ─── 2. Database connectivity ───────────────────────────────────────────────

echo ""
echo "[2/4] Database connectivity"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "  SKIP — DATABASE_URL not set"
else
  DB_CHECK=$(psql "$DATABASE_URL" -tAc "SELECT 1;" 2>&1 || true)
  if [ "$DB_CHECK" = "1" ]; then
    echo "  OK — database reachable"
  else
    echo "  FAIL — could not connect to database: $DB_CHECK"
    exit 1
  fi
fi

# ─── 3. Key table row counts ────────────────────────────────────────────────

echo ""
echo "[3/4] Key table row counts"
if [ -z "${DATABASE_URL:-}" ]; then
  echo "  SKIP — DATABASE_URL not set"
else
  for TABLE in users api_keys providers plans usage_logs; do
    COUNT=$(psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM $TABLE;" 2>&1 || echo "ERROR")
    echo "  $TABLE: $COUNT rows"
  done
fi

# ─── 4. Environment secrets present ─────────────────────────────────────────

echo ""
echo "[4/4] Required environment variables"
MISSING=0
for VAR in JWT_SECRET ENCRYPTION_KEY; do
  if [ -z "${!VAR:-}" ]; then
    echo "  MISSING — $VAR"
    MISSING=1
  else
    echo "  OK — $VAR is set"
  fi
done

if [ "$MISSING" = "1" ]; then
  echo ""
  echo "WARN: one or more required env vars are missing. Deployment may malfunction."
fi

echo ""
echo "=== Verification complete ==="
