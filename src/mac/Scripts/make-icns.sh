#!/usr/bin/env bash
# Renders an icon PNG with a Swift script and converts it into an .icns file.
# Usage: make-icns.sh <output.icns> [Packaging/make-icon.swift]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/dist/AppIcon.icns}"
SCRIPT="${2:-$ROOT/Packaging/make-icon.swift}"
WORK="$(mktemp -d)"
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET" "$(dirname "$OUT")"

swift "$SCRIPT" "$WORK/icon-1024.png" >/dev/null

for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size" "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$double" "$double" "$WORK/icon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$WORK"
echo "✓ $OUT"
