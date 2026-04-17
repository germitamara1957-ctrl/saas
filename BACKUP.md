# AI Gateway — Backup & Recovery Guide

## Overview

The platform uses PostgreSQL as its primary database. This guide covers:
- Automated daily backups with retention
- Manual backup and restore
- S3 offsite backup (optional)
- Disaster recovery checklist

---

## Quick Start

```bash
# Make scripts executable
chmod +x scripts/backup.sh scripts/restore.sh

# Run a manual backup now
DATABASE_URL="postgresql://..." ./scripts/backup.sh

# Restore from a backup
./scripts/restore.sh ./backups/aigateway_20260415_030000.sql.gz
```

---

## Automated Backups (cron)

Add to crontab (`crontab -e`) on your VPS:

```cron
# Daily backup at 3:00 AM, keep 7 days
0 3 * * * DATABASE_URL="$(grep DATABASE_URL /opt/ai-gateway/.env | cut -d= -f2-)" /opt/ai-gateway/scripts/backup.sh >> /var/log/ai-gateway/backup.log 2>&1

# Weekly backup on Sunday, keep 30 days
0 2 * * 0 RETENTION_DAYS=30 DATABASE_URL="$(grep DATABASE_URL /opt/ai-gateway/.env | cut -d= -f2-)" /opt/ai-gateway/scripts/backup.sh >> /var/log/ai-gateway/backup.log 2>&1
```

---

## S3 Offsite Backup (Recommended)

Store backups on AWS S3 for redundancy:

```bash
# Install AWS CLI
apt install awscli -y
aws configure  # Enter your AWS credentials

# Run backup with S3 upload
S3_BUCKET=my-company-backups DATABASE_URL="postgresql://..." ./scripts/backup.sh

# Cron with S3
0 3 * * * S3_BUCKET=my-company-backups DATABASE_URL="$(grep DATABASE_URL /opt/ai-gateway/.env | cut -d= -f2-)" /opt/ai-gateway/scripts/backup.sh
```

**S3 Lifecycle Policy (cost optimization):**
- Transition to S3 Glacier after 30 days
- Delete after 365 days
- Set in AWS S3 console → Bucket → Management → Lifecycle rules

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_DIR` | `/opt/ai-gateway/backups` | Local backup directory |
| `RETENTION_DAYS` | `7` | Days to keep local backups |
| `S3_BUCKET` | *(empty)* | S3 bucket name for offsite backup |
| `DATABASE_URL` | *(required)* | PostgreSQL connection string |

---

## Restore Procedure

### From local backup
```bash
# Stop the API server first
pm2 stop ai-gateway-api   # or: docker compose stop api

# Restore
./scripts/restore.sh ./backups/aigateway_20260415_030000.sql.gz

# Restart
pm2 start ai-gateway-api  # or: docker compose start api
```

### From S3
```bash
pm2 stop ai-gateway-api
./scripts/restore.sh s3://my-company-backups/aigateway/aigateway_20260415_030000.sql.gz
pm2 start ai-gateway-api
```

---

## Disaster Recovery Checklist

If the server is completely lost:

1. **Provision a new VPS** (same region as before)
2. **Clone the repository**: `git clone https://github.com/germitamara1957-ctrl/saas_api_key1 /opt/ai-gateway`
3. **Restore environment**: Copy `.env` from secure storage (password manager / secrets vault)
4. **Install dependencies**: `pnpm install && pnpm build`
5. **Restore database**: `./scripts/restore.sh s3://bucket/latest-backup.sql.gz`
6. **Start services**: `docker compose up -d` or `pm2 start ecosystem.config.cjs`
7. **Verify health**: `curl http://localhost:8080/healthz`

**Target RTO (Recovery Time Objective):** < 30 minutes  
**Target RPO (Recovery Point Objective):** < 24 hours (with daily backups)

---

## Managed Hosting Backup (Neon/Supabase)

If using **Neon** or **Supabase**, they provide automatic daily backups:

- **Neon**: Project → Settings → Branches → Point-in-time restore (up to 7 days on free tier, 30 days on paid)
- **Supabase**: Dashboard → Settings → Database → Backups (daily, 7-day retention on Pro)

You can still run the scripts above as an additional offsite copy.

---

## Monitoring Backup Health

Check the backup log:
```bash
tail -50 /var/log/ai-gateway/backup.log
# or
tail -50 /opt/ai-gateway/backups/backup.log
```

List available backups:
```bash
ls -lh /opt/ai-gateway/backups/aigateway_*.sql.gz
```

Alert if no backup in 25h (add to your monitoring):
```bash
# Find the newest backup
NEWEST=$(find /opt/ai-gateway/backups -name "*.sql.gz" -mtime -1 | wc -l)
[ "${NEWEST}" -eq 0 ] && echo "ALERT: No backup in the last 24 hours!"
```
