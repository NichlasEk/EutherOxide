#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bridge_pid=""
vite_pid=""

cleanup() {
  if [[ -n "$bridge_pid" ]] && kill -0 "$bridge_pid" 2>/dev/null; then
    kill "$bridge_pid" 2>/dev/null || true
    wait "$bridge_pid" 2>/dev/null || true
  fi
  if [[ -n "$vite_pid" ]] && kill -0 "$vite_pid" 2>/dev/null; then
    kill "$vite_pid" 2>/dev/null || true
    wait "$vite_pid" 2>/dev/null || true
  fi
}

source_stamp() {
  find Cargo.toml Cargo.lock src -type f -printf '%T@ %p\n' | sort | sha256sum | awk '{print $1}'
}

start_bridge() {
  if [[ -n "$bridge_pid" ]] && kill -0 "$bridge_pid" 2>/dev/null; then
    kill "$bridge_pid" 2>/dev/null || true
    wait "$bridge_pid" 2>/dev/null || true
  fi
  echo "[dev-bridge] starting Rust core bridge on http://127.0.0.1:32161"
  cargo run -- --web-bridge &
  bridge_pid="$!"
}

trap cleanup EXIT INT TERM

if curl -fsS --max-time 1 http://127.0.0.1:5173/ >/dev/null 2>&1; then
  echo "[dev-bridge] using existing Vite on http://127.0.0.1:5173"
else
  echo "[dev-bridge] starting Vite on http://127.0.0.1:5173"
  npm run dev -- --host 127.0.0.1 &
  vite_pid="$!"
fi

start_bridge
last_stamp="$(source_stamp)"

echo "[dev-bridge] open http://127.0.0.1:5173/?bridge=http://127.0.0.1:32161"

while sleep 1; do
  next_stamp="$(source_stamp)"
  if [[ "$next_stamp" != "$last_stamp" ]]; then
    last_stamp="$next_stamp"
    echo "[dev-bridge] Rust source changed; restarting bridge"
    start_bridge
  elif ! kill -0 "$bridge_pid" 2>/dev/null; then
    echo "[dev-bridge] bridge exited; restarting"
    start_bridge
  fi
done
