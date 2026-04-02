#!/usr/bin/env bash
# Stop the phantom service on Friday.
# Usage: ./scripts/dev-stop.sh
set -euo pipefail

HOST="${PHANTOM_HOST:-phantom}"

echo "[dev] Stopping phantom service on $HOST..."
ssh "$HOST" "sudo systemctl stop phantom"
echo "[dev] Service stopped."
