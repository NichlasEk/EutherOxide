#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -gt 0 ]]; then
  password="$1"
else
  read -r -s -p "EutherHost password: " password
  printf '\n'
  read -r -s -p "Repeat password: " repeat
  printf '\n'
  if [[ "$password" != "$repeat" ]]; then
    echo "[host-hash] passwords did not match" >&2
    exit 1
  fi
fi

if [[ -z "$password" ]]; then
  echo "[host-hash] password cannot be empty" >&2
  exit 1
fi

cargo run --bin euther-oxide -- --host-hash-password "$password"
