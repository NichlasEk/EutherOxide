#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HOST_DIR=".euther-host"
CONFIG_FILE="$HOST_DIR/config.toml"

config_value() {
  local key="$1"
  local fallback="$2"
  local value=""
  if [[ -f "$CONFIG_FILE" ]]; then
    value="$(awk -F= -v key="$key" '
      $1 ~ "^[[:space:]]*" key "[[:space:]]*$" {
        value = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        gsub(/^"|"$/, "", value)
        print value
        exit
      }
    ' "$CONFIG_FILE")"
  fi
  printf '%s\n' "${value:-$fallback}"
}

default_lan_origin() {
  local ip
  ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ && $0 !~ /^127\./ { print; exit }')"
  if [[ -z "$ip" ]]; then
    echo "[host-lan-config] could not detect LAN IP; pass LAN-IP explicitly" >&2
    exit 1
  fi
  printf 'http://%s:32162\n' "$ip"
}

normalize_lan_origin() {
  local origin="${1%/}"
  if [[ "$origin" != http://* && "$origin" != https://* ]]; then
    origin="http://$origin"
  fi
  local rest="${origin#http://}"
  rest="${rest#https://}"
  if [[ "$rest" != *:* ]]; then
    origin="$origin:32162"
  fi
  printf '%s\n' "$origin"
}

lan_origin="${1:-}"
if [[ -z "$lan_origin" ]]; then
  lan_origin="$(default_lan_origin)"
fi
lan_origin="$(normalize_lan_origin "$lan_origin")"
if [[ "$lan_origin" != http://* && "$lan_origin" != https://* ]]; then
  echo "[host-lan-config] LAN origin must be an IP, host, or URL" >&2
  exit 1
fi

bind="${2:-0.0.0.0:32162}"
rom_dir="${3:-$(config_value rom_dir "/home/nichlas/roms")}"
session_timeout_minutes="$(config_value session_timeout_minutes "720")"
login_rate_limit_window_secs="$(config_value login_rate_limit_window_secs "900")"
login_rate_limit_max_attempts="$(config_value login_rate_limit_max_attempts "8")"
secure_cookies="$(config_value secure_cookies "true")"
allowed_origins="$(config_value allowed_origins "")"
library_read_only="$(config_value library_read_only "true")"

case ",$allowed_origins," in
  *",$lan_origin,"*) ;;
  *) allowed_origins="${allowed_origins:+$allowed_origins,}$lan_origin" ;;
esac

mkdir -p "$HOST_DIR"

cat > "$CONFIG_FILE" <<EOF
bind = "$bind"
rom_dir = "$rom_dir"
session_timeout_minutes = $session_timeout_minutes
login_rate_limit_window_secs = $login_rate_limit_window_secs
login_rate_limit_max_attempts = $login_rate_limit_max_attempts
secure_cookies = $secure_cookies
allowed_origins = "$allowed_origins"
library_read_only = $library_read_only
EOF

chmod 600 "$CONFIG_FILE"

echo "[host-lan-config] wrote $CONFIG_FILE"
echo "[host-lan-config] EutherHost bind: $bind"
echo "[host-lan-config] EutherList LAN fallback URL: $lan_origin"
