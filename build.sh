#!/usr/bin/env bash
# Build Wend Electron app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$ROOT/electron"

echo "=== Installing npm dependencies ==="
npm --prefix "$ELECTRON_DIR" install

echo "=== Packaging Electron app ==="
npm --prefix "$ELECTRON_DIR" run build

echo "=== Renaming output directory ==="
OUT_DIR="$ROOT/bin/Release"
mkdir -p "$OUT_DIR"

if [ -d "$ELECTRON_DIR/bin/Release/Wend-win32-x64" ]; then
    rm -rf "$OUT_DIR/Wend"
    mv "$ELECTRON_DIR/bin/Release/Wend-win32-x64" "$OUT_DIR/Wend"
    rmdir "$ELECTRON_DIR/bin/Release" 2>/dev/null || true
fi

echo "=== Done ==="
echo "Output: $OUT_DIR/Wend"
