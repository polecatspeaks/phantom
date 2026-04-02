#!/usr/bin/env bash
# Start the phantom service on Friday and wait for health OK.
# Usage: ./scripts/dev-start.sh
set -euo pipefail

HOST="${PHANTOM_HOST:-phantom}"
HEALTH_URL="http://localhost:3100/health"

echo "[dev] Starting phantom service on $HOST..."
ssh "$HOST" "sudo systemctl start phantom"

echo "[dev] Waiting for service to become healthy..."
for i in $(seq 1 15); do
  STATUS=$(ssh "$HOST" "curl -sf $HEALTH_URL | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))\" 2>/dev/null || echo offline")
  if [ "$STATUS" = "ok" ]; then
    echo "[dev] Phantom is up (attempt $i)"
    break
  fi
  echo "[dev] Not ready yet ($STATUS), waiting 2s..."
  sleep 2
  if [ "$i" -eq 15 ]; then
    echo "[dev] ERROR: Phantom did not become healthy after 30s"
    exit 1
  fi
done
