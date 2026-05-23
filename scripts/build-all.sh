#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[build-all] building web assets"
npm run build

echo "[build-all] building headless bridge/core release"
cargo build --release

echo "[build-all] building Tauri app and Linux packages"
npm run tauri build

echo "[build-all] done"
echo "[build-all] core:   $ROOT/target/release/euther-oxide"
echo "[build-all] tauri:  $ROOT/src-tauri/target/release/euther_oxide_app"
echo "[build-all] deb:    $ROOT/src-tauri/target/release/bundle/deb/EutherOxide_0.1.0_amd64.deb"
echo "[build-all] rpm:    $ROOT/src-tauri/target/release/bundle/rpm/EutherOxide-0.1.0-1.x86_64.rpm"
