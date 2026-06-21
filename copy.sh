#!/usr/bin/env bash
# Copy frontend files and rebuild app.asar for quick dev iteration
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$ROOT/electron"
OUT_DIR="$ROOT/bin/Release/Wend"
FRONTEND_DST="$OUT_DIR/resources/frontend"
ASAR_DST="$OUT_DIR/resources/app.asar"

if [ ! -d "$OUT_DIR" ]; then
    echo "Error: Packaged app not found at $OUT_DIR"
    echo "Run build.sh first."
    exit 1
fi

echo "=== Rebuilding app.asar ==="
TEMP_PACK="$(mktemp -d)"
cp "$ELECTRON_DIR"/main.js "$TEMP_PACK/"
cp "$ELECTRON_DIR"/preload.js "$TEMP_PACK/"
cp "$ELECTRON_DIR"/package.json "$TEMP_PACK/"

npx asar pack "$TEMP_PACK" "$ASAR_DST"
rm -rf "$TEMP_PACK"

echo "=== Copying frontend files ==="
mkdir -p "$FRONTEND_DST"
cp "$ROOT/frontend"/*.html "$FRONTEND_DST/"
cp "$ROOT/frontend"/*.js "$FRONTEND_DST/"
cp "$ROOT/frontend"/*.css "$FRONTEND_DST/"
cp -r "$ROOT/frontend/lang" "$FRONTEND_DST/"
cp -r "$ROOT/frontend/lib" "$FRONTEND_DST/"
cp -r "$ROOT/frontend/wizards" "$FRONTEND_DST/"

echo "=== Done ==="
