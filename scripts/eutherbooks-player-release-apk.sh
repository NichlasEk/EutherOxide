#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/eutherbooks-player"
TAURI_DIR="$APP_DIR/src-tauri"
ANDROID_DIR="$TAURI_DIR/gen/android"
APK_OUTPUT_ROOT="$ANDROID_DIR/app/build/outputs/apk"
ANDROID_APP_GRADLE="$ANDROID_DIR/app/build.gradle.kts"
ANDROID_TARGET="${EUTHERBOOKS_PLAYER_ANDROID_TARGET:-aarch64}"
OUT_APK="${OUT_APK:-/home/nichlas/EutherBooksPlayer-release-signed.apk}"
REPO_APK="${REPO_APK:-$APP_DIR/releases/EutherBooksPlayer-release-signed.apk}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

KEYSTORE="${EUTHERBOOKS_PLAYER_KEYSTORE:-${EUTHERLIST_KEYSTORE:-/home/nichlas/.eutherlist/eutherlist-sideload.jks}}"
KEY_ALIAS="${EUTHERBOOKS_PLAYER_KEY_ALIAS:-${EUTHERLIST_KEY_ALIAS:-eutherlist}}"
KEYSTORE_PASS="${EUTHERBOOKS_PLAYER_KEYSTORE_PASS:-${EUTHERLIST_KEYSTORE_PASS:-EutherList2026}}"
KEY_PASS="${EUTHERBOOKS_PLAYER_KEY_PASS:-${EUTHERLIST_KEY_PASS:-$KEYSTORE_PASS}}"

if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "[eutherbooks-player-release-apk] Android SDK not found: $ANDROID_HOME" >&2
  exit 1
fi

if [[ ! -f "$KEYSTORE" ]]; then
  echo "[eutherbooks-player-release-apk] Keystore not found: $KEYSTORE" >&2
  exit 1
fi

if ! command -v apksigner >/dev/null 2>&1; then
  echo "[eutherbooks-player-release-apk] apksigner not found on PATH" >&2
  exit 1
fi

cd "$APP_DIR"

if [[ ! -d "$ANDROID_DIR" ]]; then
  echo "[eutherbooks-player-release-apk] initializing Android project"
  npm run android:init
fi

if [[ -f "$ANDROID_APP_GRADLE" ]]; then
  perl -0pi -e 's/manifestPlaceholders\["usesCleartextTraffic"\] = "false"/manifestPlaceholders["usesCleartextTraffic"] = "true"/' "$ANDROID_APP_GRADLE"
fi

ANDROID_MANIFEST="$ANDROID_DIR/app/src/main/AndroidManifest.xml"
if [[ -f "$ANDROID_MANIFEST" ]] && ! grep -q 'android.permission.WAKE_LOCK' "$ANDROID_MANIFEST"; then
  echo "[eutherbooks-player-release-apk] enabling Android wake lock permission"
  perl -0pi -e 's#(<uses-permission android:name="android.permission.INTERNET" />)#$1\n    <uses-permission android:name="android.permission.WAKE_LOCK" />#' "$ANDROID_MANIFEST"
fi

if [[ -d "$TAURI_DIR/icons/android" ]]; then
  echo "[eutherbooks-player-release-apk] syncing Android launcher icons"
  mkdir -p "$ANDROID_DIR/app/src/main/res"
  cp -R "$TAURI_DIR/icons/android/." "$ANDROID_DIR/app/src/main/res/"
fi

echo "[eutherbooks-player-release-apk] building unsigned APK"
npm run android:build -- --target "$ANDROID_TARGET"

UNSIGNED_APK="$(
  find "$APK_OUTPUT_ROOT" -type f -name '*release-unsigned.apk' -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print }'
)"

if [[ -z "$UNSIGNED_APK" || ! -f "$UNSIGNED_APK" ]]; then
  echo "[eutherbooks-player-release-apk] unsigned APK not found under: $APK_OUTPUT_ROOT" >&2
  exit 1
fi

SIGNED_APK="$(dirname "$UNSIGNED_APK")/EutherBooksPlayer-${ANDROID_TARGET}-release-signed.apk"

echo "[eutherbooks-player-release-apk] signing APK"
rm -f "$SIGNED_APK" "$SIGNED_APK.idsig" "$OUT_APK" "$OUT_APK.idsig" "$REPO_APK" "$REPO_APK.idsig"
apksigner sign \
  --ks "$KEYSTORE" \
  --ks-key-alias "$KEY_ALIAS" \
  --ks-pass "pass:$KEYSTORE_PASS" \
  --key-pass "pass:$KEY_PASS" \
  --out "$SIGNED_APK" \
  "$UNSIGNED_APK"

mkdir -p "$(dirname "$OUT_APK")"
cp "$SIGNED_APK" "$OUT_APK"
mkdir -p "$(dirname "$REPO_APK")"
cp "$SIGNED_APK" "$REPO_APK"

apksigner verify "$OUT_APK"

echo "[eutherbooks-player-release-apk] ready: $OUT_APK"
echo "[eutherbooks-player-release-apk] repo copy: $REPO_APK"
