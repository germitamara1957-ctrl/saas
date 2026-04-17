#!/usr/bin/env bash
# AI Gateway — VPS Deployment Helper
# Usage: bash deploy.sh [--pull] [--build] [--restart]
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

PULL=false
BUILD=false
RESTART=false

for arg in "$@"; do
  case $arg in
    --pull)    PULL=true ;;
    --build)   BUILD=true ;;
    --restart) RESTART=true ;;
    --all)     PULL=true; BUILD=true; RESTART=true ;;
    *)         echo "Unknown option: $arg"; exit 1 ;;
  esac
done

if [[ "$PULL" == "true" ]]; then
  echo "📥  Pulling latest code..."
  git pull origin main
fi

if [[ ! -f ".env" ]]; then
  echo "❌  .env file not found. Copy .env.example and fill in the values:"
  echo "    cp .env.example .env && nano .env"
  exit 1
fi

if [[ "$BUILD" == "true" ]]; then
  echo "🔨  Building Docker images..."
  docker compose build --no-cache
fi

if [[ "$RESTART" == "true" ]]; then
  echo "🚀  Starting / restarting services..."
  docker compose up -d
  echo ""
  echo "✅  Services started. Checking health..."
  sleep 8
  docker compose ps
fi

echo ""
echo "📋  Logs (last 30 lines per service):"
docker compose logs --tail=30
