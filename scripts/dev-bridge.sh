#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bridge_pid=""
vite_pid=""
control_dir=".euther-bridge"
profile_file="$control_dir/profile"
release_bin="target/release/euther-oxide"

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
  find Cargo.toml Cargo.lock src -type f -print0 \
    | sort -z \
    | xargs -0 sha256sum \
    | sha256sum \
    | awk '{print $1}'
}

release_stamp() {
  if [[ -f "$release_bin" ]]; then
    stat -c '%Y:%s' "$release_bin"
  else
    printf 'missing'
  fi
}

requested_profile() {
  local profile="debug"
  if [[ -f "$profile_file" ]]; then
    profile="$(<"$profile_file")"
  elif [[ "${EUTHER_BRIDGE_RELEASE:-0}" == "1" ]]; then
    profile="release"
  fi
  if [[ "$profile" != "release" ]]; then
    profile="debug"
  fi
  printf '%s' "$profile"
}

start_bridge() {
  if [[ -n "$bridge_pid" ]] && kill -0 "$bridge_pid" 2>/dev/null; then
    kill "$bridge_pid" 2>/dev/null || true
    wait "$bridge_pid" 2>/dev/null || true
  fi

  local profile
  profile="$(requested_profile)"
  if [[ "$profile" == "release" ]]; then
    if [[ ! -x "$release_bin" ]]; then
      echo "[dev-bridge] release binary missing; building it first"
      bash scripts/build-release.sh
    fi
    echo "[dev-bridge] starting Rust core bridge (release bin) on http://127.0.0.1:32161"
    EUTHER_BRIDGE_PROFILE=release "$release_bin" --web-bridge &
  else
    echo "[dev-bridge] starting Rust core bridge (debug) on http://127.0.0.1:32161"
    EUTHER_BRIDGE_PROFILE=debug cargo run -- --web-bridge &
  fi
  bridge_pid="$!"
}

trap cleanup EXIT INT TERM
mkdir -p "$control_dir"
if [[ "${EUTHER_BRIDGE_RELEASE:-0}" == "1" ]]; then
  printf 'release' > "$profile_file"
elif [[ ! -f "$profile_file" ]]; then
  printf 'debug' > "$profile_file"
fi

if curl -fsS --max-time 1 http://127.0.0.1:5173/ >/dev/null 2>&1; then
  echo "[dev-bridge] using existing Vite on http://127.0.0.1:5173"
else
  echo "[dev-bridge] starting Vite on http://127.0.0.1:5173"
  npm run dev -- --host 127.0.0.1 &
  vite_pid="$!"
fi

start_bridge
last_stamp="$(source_stamp)"
last_release_stamp="$(release_stamp)"
last_profile="$(requested_profile)"

echo "[dev-bridge] open http://127.0.0.1:5173/?bridge=http://127.0.0.1:32161"

while sleep 1; do
  next_stamp="$(source_stamp)"
  next_release_stamp="$(release_stamp)"
  next_profile="$(requested_profile)"
  if [[ "$next_profile" != "$last_profile" ]]; then
    last_profile="$next_profile"
    last_stamp="$next_stamp"
    last_release_stamp="$next_release_stamp"
    echo "[dev-bridge] bridge profile changed; restarting bridge"
    start_bridge
  elif [[ "$next_profile" == "release" && "$next_release_stamp" != "$last_release_stamp" ]]; then
    last_release_stamp="$next_release_stamp"
    last_stamp="$next_stamp"
    echo "[dev-bridge] release binary changed; restarting bridge"
    start_bridge
  elif [[ "$next_profile" == "debug" && "$next_stamp" != "$last_stamp" ]]; then
    last_stamp="$next_stamp"
    echo "[dev-bridge] Rust source changed; restarting bridge"
    start_bridge
  elif ! kill -0 "$bridge_pid" 2>/dev/null; then
    echo "[dev-bridge] bridge exited; restarting"
    start_bridge
  fi
done
