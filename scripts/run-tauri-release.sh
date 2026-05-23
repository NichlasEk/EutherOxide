#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

APP="$ROOT/src-tauri/target/release/euther_oxide_app"
if [[ ! -x "$APP" ]]; then
  echo "[run-tauri-release] release app missing; building all first"
  bash scripts/build-all.sh
fi

exec "$APP"
