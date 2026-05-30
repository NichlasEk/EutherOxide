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
secure_cookies="$(awk -F= '/^[[:space:]]*secure_cookies[[:space:]]*=/{gsub(/[ "]/, "", $2); print $2; exit}' "$CONFIG_FILE")"
allowed_origins="$(awk -F= '/^[[:space:]]*allowed_origins[[:space:]]*=/{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); gsub(/^"|"$/, "", $2); print $2; exit}' "$CONFIG_FILE")"

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
if [[ "$secure_cookies" == "true" ]]; then
  echo "[host-server] public mode: Secure cookies enabled; serve through HTTPS reverse proxy"
  echo "[host-server] allowed origins: ${allowed_origins:-not set}"
else
  echo "[host-server] LAN mode: run scripts/host-public-config.sh before exposing through HTTPS"
fi
exec target/release/euther-oxide --host-server
