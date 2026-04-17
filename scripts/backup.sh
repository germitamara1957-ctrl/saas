#!/usr/bin/env bash
# =============================================================================
# AI Gateway — PostgreSQL Backup Script
# =============================================================================
# Usage:
#   ./scripts/backup.sh                   # Backup to ./backups/
#   BACKUP_DIR=/var/backups ./scripts/backup.sh
#   S3_BUCKET=my-bucket ./scripts/backup.sh  # Upload to S3 after backup
#
# Requires:
#   - pg_dump (PostgreSQL client tools)
#   - DATABASE_URL environment variable (or loaded from .env)
#   - aws CLI (optional, only for S3 upload)
# =============================================================================

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/opt/ai-gateway/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
S3_BUCKET="${S3_BUCKET:-}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/aigateway_${TIMESTAMP}.sql.gz"
LOG_FILE="${BACKUP_DIR}/backup.log"

# ── Load DATABASE_URL from .env if not already set ────────────────────────────
if [ -z "${DATABASE_URL:-}" ] && [ -f /opt/ai-gateway/.env ]; then
  export $(grep -E "^DATABASE_URL=" /opt/ai-gateway/.env | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set. Export it or add it to .env" >&2
  exit 1
fi

# ── Setup ─────────────────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

log "Starting backup → ${BACKUP_FILE}"

# ── Run pg_dump ───────────────────────────────────────────────────────────────
pg_dump "${DATABASE_URL}" \
  --format=plain \
  --no-owner \
  --no-acl \
  --verbose 2>>"${LOG_FILE}" \
  | gzip -9 > "${BACKUP_FILE}"

BACKUP_SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
log "Backup complete. Size: ${BACKUP_SIZE}"

# ── Upload to S3 (optional) ───────────────────────────────────────────────────
if [ -n "${S3_BUCKET}" ]; then
  if command -v aws &>/dev/null; then
    S3_PATH="s3://${S3_BUCKET}/aigateway/$(basename "${BACKUP_FILE}")"
    log "Uploading to ${S3_PATH}..."
    aws s3 cp "${BACKUP_FILE}" "${S3_PATH}" --storage-class STANDARD_IA
    log "S3 upload complete."
  else
    log "WARNING: S3_BUCKET set but 'aws' CLI not found. Skipping S3 upload."
  fi
fi

# ── Retention: remove backups older than RETENTION_DAYS ───────────────────────
log "Removing backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "aigateway_*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete
REMAINING=$(find "${BACKUP_DIR}" -name "aigateway_*.sql.gz" | wc -l | tr -d ' ')
log "Retention cleanup done. ${REMAINING} backup(s) retained."

log "Backup finished successfully."
