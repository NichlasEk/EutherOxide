#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST_DIR=".euther-host"
CONFIG_FILE="$HOST_DIR/config.toml"

origin="${1:-}"
rom_dir="${2:-}"

if [[ -z "$origin" ]]; then
  read -r -p "Public HTTPS origin [https://euther.example.com]: " origin
  origin="${origin:-https://euther.example.com}"
fi

if [[ "$origin" != https://* ]]; then
  echo "[host-public-config] origin must start with https://" >&2
  exit 1
fi

if [[ -z "$rom_dir" ]]; then
  if [[ -f "$CONFIG_FILE" ]]; then
    rom_dir="$(awk -F= '/^[[:space:]]*rom_dir[[:space:]]*=/{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); gsub(/^"|"$/, "", $2); print $2; exit}' "$CONFIG_FILE")"
  fi
  rom_dir="${rom_dir:-/home/nichlas/roms}"
fi

mkdir -p "$HOST_DIR"

cat > "$CONFIG_FILE" <<EOF
bind = "127.0.0.1:32162"
rom_dir = "$rom_dir"
session_timeout_minutes = 720
login_rate_limit_window_secs = 900
login_rate_limit_max_attempts = 8
secure_cookies = true
allowed_origins = "$origin"
library_read_only = true
EOF

chmod 600 "$CONFIG_FILE"

echo "[host-public-config] wrote $CONFIG_FILE"
echo "[host-public-config] reverse proxy should serve $origin and proxy to http://127.0.0.1:32162"
