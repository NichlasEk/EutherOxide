#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/eutherlist"
APK_DIR="$APP_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/release"
APK_OUTPUT_ROOT="$APP_DIR/src-tauri/gen/android/app/build/outputs/apk"
ANDROID_TARGET="${EUTHERLIST_ANDROID_TARGET:-aarch64}"
OUT_APK="${OUT_APK:-/home/nichlas/EutherList-release-signed.apk}"
REPO_APK="${REPO_APK:-$ROOT/apps/eutherlist/releases/EutherList-release-signed.apk}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

KEYSTORE="${EUTHERLIST_KEYSTORE:-/home/nichlas/.eutherlist/eutherlist-sideload.jks}"
KEY_ALIAS="${EUTHERLIST_KEY_ALIAS:-eutherlist}"
KEYSTORE_PASS="${EUTHERLIST_KEYSTORE_PASS:-EutherList2026}"
KEY_PASS="${EUTHERLIST_KEY_PASS:-$KEYSTORE_PASS}"

if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "[eutherlist-release-apk] Android SDK not found: $ANDROID_HOME" >&2
  exit 1
fi

if [[ ! -f "$KEYSTORE" ]]; then
  echo "[eutherlist-release-apk] Keystore not found: $KEYSTORE" >&2
  exit 1
fi

if ! command -v apksigner >/dev/null 2>&1; then
  echo "[eutherlist-release-apk] apksigner not found on PATH" >&2
  exit 1
fi

echo "[eutherlist-release-apk] building unsigned APK"
cd "$APP_DIR"
npm run android:build -- --target "$ANDROID_TARGET"

UNSIGNED_APK="$(
  find "$APK_OUTPUT_ROOT" -type f -name '*release-unsigned.apk' -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print }'
)"

if [[ -z "$UNSIGNED_APK" || ! -f "$UNSIGNED_APK" ]]; then
  echo "[eutherlist-release-apk] unsigned APK not found under: $APK_OUTPUT_ROOT" >&2
  exit 1
fi

SIGNED_APK="$(dirname "$UNSIGNED_APK")/EutherList-${ANDROID_TARGET}-release-signed.apk"

echo "[eutherlist-release-apk] signing APK"
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

echo "[eutherlist-release-apk] ready: $OUT_APK"
echo "[eutherlist-release-apk] repo copy: $REPO_APK"
