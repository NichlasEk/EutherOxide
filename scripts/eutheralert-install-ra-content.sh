#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUPPORT_DIR="${1:-"${EUTHERALERT_OPENRA_SUPPORT_DIR:-"$ROOT/.euther-host/openra-alert/alert-2/client"}"}"
TARGET_DIR="$SUPPORT_DIR/Content/ra/v2"
OWNER="${EUTHERALERT_OPENRA_CONTENT_OWNER:-}"
ZIP_PATH="${TMPDIR:-/tmp}/ra-quickinstall.zip"
EXTRACT_DIR="${TMPDIR:-/tmp}/ra-quickinstall-extract"
EXPECTED_SHA1="44241f68e69db9511db82cf83c174737ccda300b"
MIRRORS=(
  "https://openra.ppmsite.com/ra-quickinstall.zip"
  "https://republic.community/hosted/files/command-and-conquer/openra/ra-quickinstall.zip"
  "https://cdn.mailaender.name/openra/ra-quickinstall.zip"
  "https://openra.0x47.net/ra-quickinstall.zip"
  "https://openra.baxxster.no/openra/ra-quickinstall.zip"
)

mkdir -p "$EXTRACT_DIR"

downloaded=0
for mirror in "${MIRRORS[@]}"; do
  echo "Downloading $mirror"
  if curl -L --fail "$mirror" -o "$ZIP_PATH"; then
    actual_sha1="$(sha1sum "$ZIP_PATH" | awk '{print $1}')"
    if [ "$actual_sha1" = "$EXPECTED_SHA1" ]; then
      downloaded=1
      break
    fi
    echo "SHA1 mismatch from $mirror: $actual_sha1" >&2
  fi
done

if [ "$downloaded" != 1 ]; then
  echo "Failed to download verified ra-quickinstall.zip" >&2
  exit 1
fi

rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR" "$TARGET_DIR"
unzip -o "$ZIP_PATH" -d "$EXTRACT_DIR"
cp -a "$EXTRACT_DIR"/. "$TARGET_DIR"/

if [ -n "$OWNER" ]; then
  chown -R "$OWNER" "$SUPPORT_DIR/Content"
fi

echo "Installed OpenRA Red Alert quickinstall content:"
echo "  $TARGET_DIR"
