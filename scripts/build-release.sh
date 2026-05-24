#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTROL_DIR=".euther-bridge"
STATUS_FILE="$CONTROL_DIR/build-status"
BIN_PATH="target/release/euther-oxide"

mkdir -p "$CONTROL_DIR"

now_ms() {
  date +%s%3N
}

write_status() {
  local state="$1"
  local message="$2"
  local tmp="$STATUS_FILE.tmp"
  {
    printf 'state=%s\n' "$state"
    printf 'message=%s\n' "$message"
    printf 'updated_unix_ms=%s\n' "$(now_ms)"
    printf 'release_path=%s\n' "$BIN_PATH"
  } > "$tmp"
  mv "$tmp" "$STATUS_FILE"
}

write_status "building" "Building release binary"
node scripts/write-build-info.mjs

if cargo build --release; then
  write_status "ready" "Release binary ready"
else
  write_status "failed" "Release build failed"
  exit 1
fi
