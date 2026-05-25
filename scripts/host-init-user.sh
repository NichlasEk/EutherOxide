#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST_DIR=".euther-host"
CONFIG_FILE="$HOST_DIR/config.toml"
USERS_FILE="$HOST_DIR/users.toml"

mkdir -p "$HOST_DIR"

username="${1:-}"
rom_dir="${2:-}"

if [[ -z "$username" ]]; then
  read -r -p "EutherHost username [nichlas]: " username
  username="${username:-nichlas}"
fi

if [[ -z "$rom_dir" ]]; then
  read -r -p "ROM directory [/home/nichlas/roms]: " rom_dir
  rom_dir="${rom_dir:-/home/nichlas/roms}"
fi

read -r -s -p "EutherHost password: " password
printf '\n'
read -r -s -p "Repeat password: " repeat
printf '\n'
if [[ "$password" != "$repeat" ]]; then
  echo "[host-init] passwords did not match" >&2
  exit 1
fi

if [[ -z "$password" ]]; then
  echo "[host-init] password cannot be empty" >&2
  exit 1
fi

password_hash="$(cargo run --quiet --bin euther-oxide -- --host-hash-password "$password")"

cat > "$CONFIG_FILE" <<EOF
bind = "127.0.0.1:32162"
rom_dir = "$rom_dir"
EOF

cat > "$USERS_FILE" <<EOF
[[user]]
name = "$username"
password_hash = "$password_hash"
EOF

chmod 600 "$USERS_FILE"

echo "[host-init] wrote $CONFIG_FILE"
echo "[host-init] wrote $USERS_FILE"
echo "[host-init] start with: scripts/host-server.sh"
