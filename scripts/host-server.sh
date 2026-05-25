#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST_DIR=".euther-host"
CONFIG_FILE="$HOST_DIR/config.toml"
USERS_FILE="$HOST_DIR/users.toml"

if [[ ! -f "$CONFIG_FILE" || ! -f "$USERS_FILE" ]]; then
  echo "[host-server] missing host config or users"
  echo "[host-server] run: scripts/host-init-user.sh"
  exit 1
fi

bind="$(awk -F= '/^[[:space:]]*bind[[:space:]]*=/{gsub(/[ "]/, "", $2); print $2; exit}' "$CONFIG_FILE")"
bind="${bind:-127.0.0.1:32162}"

if [[ "${EUTHER_HOST_DEBUG:-0}" == "1" ]]; then
  echo "[host-server] starting debug host at http://$bind"
  echo "[host-server] debug is slow; use this only while inspecting Rust behavior"
  exec cargo run --bin euther-oxide -- --host-server
fi

if [[ ! -x target/release/euther-oxide ]]; then
  echo "[host-server] release binary missing; building it first"
  bash scripts/build-release.sh
fi

echo "[host-server] starting release host at http://$bind"
echo "[host-server] LAN note: set bind = \"0.0.0.0:32162\" in $CONFIG_FILE when you want phone/PC access on local network"
exec target/release/euther-oxide --host-server
