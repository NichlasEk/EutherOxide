#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GAME_DIR="$ROOT/crates/euthercivet-game"
PUBLIC_DIR="$ROOT/webview/public/euthercivet-game"
WASM_PATH="$GAME_DIR/target/wasm32-unknown-unknown/release/euther_civet.wasm"
WASM_BINDGEN="${WASM_BINDGEN:-wasm-bindgen}"

if ! command -v "$WASM_BINDGEN" >/dev/null 2>&1; then
  WASM_BINDGEN="$HOME/.cargo/bin/wasm-bindgen"
fi

cd "$ROOT"

cargo build --manifest-path "$GAME_DIR/Cargo.toml" --target wasm32-unknown-unknown --release

rm -rf "$PUBLIC_DIR/assets" "$PUBLIC_DIR/pkg"
mkdir -p "$PUBLIC_DIR/pkg"

"$WASM_BINDGEN" \
  --target web \
  --out-dir "$PUBLIC_DIR/pkg" \
  --out-name euthercivet \
  "$WASM_PATH"

cp -R "$GAME_DIR/assets" "$PUBLIC_DIR/assets"

cat > "$PUBLIC_DIR/index.html" <<'HTML'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>EutherCivet</title>
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #101d16;
    }

    #euthercivet-bevy-canvas {
      display: block;
      width: 100%;
      height: 100%;
      outline: none;
      touch-action: none;
    }

    #euthercivet-load-error {
      position: fixed;
      inset: 0;
      display: none;
      place-items: center;
      padding: 24px;
      color: #ffe8b3;
      background: #101d16;
      font: 700 15px system-ui, sans-serif;
      text-align: center;
    }
  </style>
</head>
<body>
  <canvas id="euthercivet-bevy-canvas"></canvas>
  <div id="euthercivet-load-error"></div>
  <script type="module">
    import init from "./pkg/euthercivet.js";

    init().catch((error) => {
      console.error(error);
      const target = document.querySelector("#euthercivet-load-error");
      target.textContent = error?.message ?? String(error);
      target.style.display = "grid";
    });
  </script>
</body>
</html>
HTML

echo "[euthercivet-web] wrote $PUBLIC_DIR"
