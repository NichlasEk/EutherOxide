#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/euthersync-android"
APK_OUTPUT_ROOT="$APP_DIR/app/build/outputs/apk"
OUT_APK="${OUT_APK:-/home/nichlas/EutherSync-release-signed.apk}"
REPO_APK="${REPO_APK:-$ROOT/apps/euthersync/releases/EutherSync-release-signed.apk}"
EUTHERSYNC_ANDROID_URL="${EUTHERSYNC_ANDROID_URL:-http://192.168.32.186:3000}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

KEYSTORE="${EUTHERSYNC_KEYSTORE:-/home/nichlas/.eutherlist/eutherlist-sideload.jks}"
KEY_ALIAS="${EUTHERSYNC_KEY_ALIAS:-eutherlist}"
KEYSTORE_PASS="${EUTHERSYNC_KEYSTORE_PASS:-EutherList2026}"
KEY_PASS="${EUTHERSYNC_KEY_PASS:-$KEYSTORE_PASS}"

if [[ ! -d "$ANDROID_HOME" ]]; then
  echo "[euthersync-release-apk] Android SDK not found: $ANDROID_HOME" >&2
  exit 1
fi

if [[ ! -f "$KEYSTORE" ]]; then
  echo "[euthersync-release-apk] Keystore not found: $KEYSTORE" >&2
  exit 1
fi

if ! command -v apksigner >/dev/null 2>&1; then
  echo "[euthersync-release-apk] apksigner not found on PATH" >&2
  exit 1
fi

echo "[euthersync-release-apk] building unsigned APK for $EUTHERSYNC_ANDROID_URL"
cd "$APP_DIR"
./gradlew assembleRelease -PeutherSyncUrl="$EUTHERSYNC_ANDROID_URL"

UNSIGNED_APK="$(
  find "$APK_OUTPUT_ROOT" -type f -name '*release-unsigned.apk' -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR == 1 { sub(/^[^ ]+ /, ""); print }'
)"

if [[ -z "$UNSIGNED_APK" || ! -f "$UNSIGNED_APK" ]]; then
  echo "[euthersync-release-apk] unsigned APK not found under: $APK_OUTPUT_ROOT" >&2
  exit 1
fi

SIGNED_APK="$(dirname "$UNSIGNED_APK")/EutherSync-release-signed.apk"

echo "[euthersync-release-apk] signing APK"
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

echo "[euthersync-release-apk] ready: $OUT_APK"
echo "[euthersync-release-apk] repo copy: $REPO_APK"
