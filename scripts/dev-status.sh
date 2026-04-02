#!/usr/bin/env bash
# Show live status of the phantom service on Friday.
# Usage: ./scripts/dev-status.sh
set -euo pipefail

HOST="${PHANTOM_HOST:-phantom}"

echo "=== systemd status ==="
ssh "$HOST" "systemctl status phantom.service --no-pager -l" || true

echo ""
echo "=== health endpoint ==="
ssh "$HOST" "curl -sf http://localhost:3100/health | python3 -m json.tool 2>/dev/null || echo '(offline or no response)'"
