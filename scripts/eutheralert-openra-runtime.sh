#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENRA_DIR="${EUTHERALERT_OPENRA_PATH:-"$ROOT/.euther-openra/OpenRA"}"
OPENRA_REF="${EUTHERALERT_OPENRA_REF:-release-20250330}"
DOTNET_DIR="${EUTHERALERT_DOTNET_ROOT:-"$ROOT/.euther-openra/dotnet"}"
DOTNET_INSTALL="${TMPDIR:-/tmp}/dotnet-install.sh"

mkdir -p "$(dirname "$OPENRA_DIR")"

if [ ! -d "$OPENRA_DIR/.git" ]; then
  git clone --depth 1 --branch "$OPENRA_REF" https://github.com/OpenRA/OpenRA.git "$OPENRA_DIR"
else
  git -C "$OPENRA_DIR" fetch --depth 1 origin "$OPENRA_REF"
  git -C "$OPENRA_DIR" checkout FETCH_HEAD
fi

if [ ! -x "$DOTNET_DIR/dotnet" ]; then
  curl -L https://dot.net/v1/dotnet-install.sh -o "$DOTNET_INSTALL"
  bash "$DOTNET_INSTALL" --channel 8.0 --install-dir "$DOTNET_DIR"
fi

if [ -x "$DOTNET_DIR/dotnet" ]; then
  export DOTNET_ROOT="$DOTNET_DIR"
  export PATH="$DOTNET_DIR:$PATH"
fi

if ! "$DOTNET_DIR/dotnet" --list-runtimes | grep -q '^Microsoft.NETCore.App 6\.'; then
  [ -f "$DOTNET_INSTALL" ] || curl -L https://dot.net/v1/dotnet-install.sh -o "$DOTNET_INSTALL"
  bash "$DOTNET_INSTALL" --channel 6.0 --runtime dotnet --install-dir "$DOTNET_DIR"
fi

make -C "$OPENRA_DIR"

cat <<EOF
OpenRA runtime ready:
  $OPENRA_DIR

Use with EutherOxide:
  EUTHERALERT_OPENRA_PATH="$OPENRA_DIR"
  EUTHERALERT_DOTNET_ROOT="$DOTNET_DIR"

Dedicated Red Alert launcher:
  "$OPENRA_DIR/launch-dedicated.sh"
EOF
