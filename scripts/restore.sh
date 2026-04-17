#!/usr/bin/env bash
# =============================================================================
# AI Gateway — PostgreSQL Restore Script
# =============================================================================
# Usage:
#   ./scripts/restore.sh ./backups/aigateway_20260415_030000.sql.gz
#   ./scripts/restore.sh s3://my-bucket/aigateway/aigateway_20260415_030000.sql.gz
#
# WARNING: This will DROP and recreate the database schema.
#          Run ONLY on a stopped or maintenance-mode API server.
# =============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage: $0 <backup-file.sql.gz|s3://bucket/path/file.sql.gz>"
  exit 1
fi

# ── Load DATABASE_URL ─────────────────────────────────────────────────────────
if [ -z "${DATABASE_URL:-}" ] && [ -f /opt/ai-gateway/.env ]; then
  export $(grep -E "^DATABASE_URL=" /opt/ai-gateway/.env | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set." >&2
  exit 1
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# ── Download from S3 if needed ─────────────────────────────────────────────────
LOCAL_FILE="${BACKUP_FILE}"
if [[ "${BACKUP_FILE}" == s3://* ]]; then
  LOCAL_FILE="/tmp/restore_$(date +%s).sql.gz"
  log "Downloading from S3: ${BACKUP_FILE} → ${LOCAL_FILE}"
  aws s3 cp "${BACKUP_FILE}" "${LOCAL_FILE}"
fi

if [ ! -f "${LOCAL_FILE}" ]; then
  echo "ERROR: File not found: ${LOCAL_FILE}" >&2
  exit 1
fi

FILE_SIZE=$(du -sh "${LOCAL_FILE}" | cut -f1)
log "Restoring from: ${LOCAL_FILE} (${FILE_SIZE})"

# ── Safety confirmation ────────────────────────────────────────────────────────
echo ""
echo "⚠️  WARNING: This will restore the database from backup."
echo "    Target: ${DATABASE_URL%@*}@***"
echo "    File:   ${LOCAL_FILE}"
echo ""
read -p "Type 'yes' to continue: " CONFIRM
if [ "${CONFIRM}" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# ── Restore ───────────────────────────────────────────────────────────────────
log "Starting restore..."
gunzip -c "${LOCAL_FILE}" | psql "${DATABASE_URL}" --single-transaction

log "Restore complete. Verify the application is working correctly."

# ── Cleanup temp file if downloaded from S3 ───────────────────────────────────
if [[ "${BACKUP_FILE}" == s3://* ]]; then
  rm -f "${LOCAL_FILE}"
fi
