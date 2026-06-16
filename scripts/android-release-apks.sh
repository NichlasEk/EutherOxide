#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[android-release-apks] building EutherList"
"$ROOT/scripts/eutherlist-release-apk.sh"

echo "[android-release-apks] building EutherSync"
"$ROOT/scripts/euthersync-release-apk.sh"

echo "[android-release-apks] building EutherBooks Player"
"$ROOT/scripts/eutherbooks-player-release-apk.sh"

echo "[android-release-apks] ready"
echo "[android-release-apks] EutherList: /home/nichlas/EutherList-release-signed.apk"
echo "[android-release-apks] EutherSync: /home/nichlas/EutherSync-release-signed.apk"
echo "[android-release-apks] EutherBooks Player: /home/nichlas/EutherBooksPlayer-release-signed.apk"
