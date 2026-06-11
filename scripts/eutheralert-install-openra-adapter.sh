#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENRA_DIR="${EUTHERALERT_OPENRA_PATH:-"$ROOT/.euther-openra/OpenRA"}"
SOURCE_DIR="$ROOT/tools/eutheralert-openra-adapter/openra-side"
TARGET_DIR="$OPENRA_DIR/OpenRA.Game/EutherAlert"
GAME_CS="$OPENRA_DIR/OpenRA.Game/Game.cs"

if [ ! -d "$OPENRA_DIR/.git" ]; then
  echo "OpenRA checkout not found at $OPENRA_DIR" >&2
  echo "Run scripts/eutheralert-openra-runtime.sh first." >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
install -m 0644 "$SOURCE_DIR/EutherAlertTouchBridge.cs" "$TARGET_DIR/EutherAlertTouchBridge.cs"

python3 - "$GAME_CS" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
old = "Renderer.EndFrame(new DefaultInputHandler(OrderManager.World));"
old_wrong = "Renderer.EndFrame(OpenRA.Mods.Common.EutherAlert.EutherAlertTouchBridge.Wrap(new DefaultInputHandler(OrderManager.World)));"
new = "Renderer.EndFrame(OpenRA.EutherAlert.EutherAlertTouchBridge.Wrap(new DefaultInputHandler(OrderManager.World)));"

if new not in text:
    if old_wrong in text:
        text = text.replace(old_wrong, new, 1)
    elif old in text:
        text = text.replace(old, new, 1)
    else:
        raise SystemExit(f"could not find OpenRA input handler hook in {path}")
    path.write_text(text, encoding="utf-8")
PY

cat <<EOF
Installed EutherAlert OpenRA adapter template:
  $TARGET_DIR/EutherAlertTouchBridge.cs
Patched OpenRA input handler:
  $GAME_CS

Rebuild OpenRA:
  EUTHERALERT_OPENRA_PATH="$OPENRA_DIR" scripts/eutheralert-openra-runtime.sh
EOF
