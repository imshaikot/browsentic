#!/usr/bin/env bash
# Builds Browsentic.app: the native control panel, with the CLI, the daemon, the bundled skills
# and the extension build carried inside it as Contents/Resources/payload.
#
# It stages and validates; it never builds the JavaScript. Run `yarn build` and
# `yarn daemon:build` first, the same contract src/daemon/scripts/stage-extension.mjs keeps.
set -euo pipefail

MAC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$MAC/../.." && pwd)"
DAEMON="$REPO/src/daemon"
EXTENSION="$REPO/dist/chrome-mv3"
DIST="$REPO/dist/mac"
APP="$DIST/Browsentic.app"
ARCHS="${ARCHS:-arm64 x86_64}"

die() { printf '\nbuild-app: %s\n  %s\n\n' "$1" "${2:-}" >&2; exit 1; }
field() { /usr/bin/python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['version'])" "$1"; }

[ -f "$EXTENSION/manifest.json" ] || die "no extension build at dist/chrome-mv3" "Run \`yarn build\` at the repository root first."
[ -f "$DAEMON/dist/cli.js" ] || die "no daemon build at src/daemon/dist/cli.js" "Run \`yarn daemon:build\` first."

VERSION="${VERSION:-$(field "$DAEMON/package.json")}"
BUILT="$(field "$EXTENSION/manifest.json")"
[ "$BUILT" = "$VERSION" ] || die "the built extension is $BUILT but the package is $VERSION" "Rebuild it after bumping the version: \`yarn build\`."
grep -q "\"$VERSION\"" "$DAEMON/dist/cli.js" || die "src/daemon/dist/cli.js was not built from $VERSION" "Run \`yarn daemon:build\`."
BUILD_NUMBER="${BUILD_NUMBER:-$(git -C "$REPO" rev-list --count HEAD 2>/dev/null || echo 1)}"

cd "$MAC"
echo "▸ Building Browsentic $VERSION ($BUILD_NUMBER) for: $ARCHS"
slices=()
for arch in $ARCHS; do
  swift build -c release --triple "${arch}-apple-macosx14.0" --product Browsentic
  slices+=(".build/${arch}-apple-macosx/release/Browsentic")
done

mkdir -p "$DIST"
BIN="$DIST/Browsentic.bin"
if [ ${#slices[@]} -gt 1 ]; then
  lipo -create "${slices[@]}" -output "$BIN"
else
  cp "${slices[0]}" "$BIN"
fi

echo "▸ Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mv "$BIN" "$APP/Contents/MacOS/Browsentic"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD_NUMBER/" Packaging/Info.plist > "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"

[ -f "$DIST/AppIcon.icns" ] || "$MAC/Scripts/make-icns.sh" "$DIST/AppIcon.icns" "$MAC/Packaging/make-icon.swift"
cp "$DIST/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

# The npm package's layout, because cli.js resolves ../skills and ../extension from dist/.
PAYLOAD="$APP/Contents/Resources/payload"
mkdir -p "$PAYLOAD/dist" "$PAYLOAD/extension"
cp "$DAEMON/dist/cli.js" "$DAEMON/dist/daemon-main.js" "$PAYLOAD/dist/"
cp -R "$DAEMON/skills" "$PAYLOAD/skills"
cp -R "$EXTENSION" "$PAYLOAD/extension/chrome-mv3"
cp "$DAEMON/package.json" "$DAEMON/LICENSE" "$PAYLOAD/"
find "$PAYLOAD" -name .DS_Store -delete

# Notarization only accepts a Developer ID signature with the hardened runtime and a secure
# timestamp. Under the hardened runtime, opening chrome://extensions over Apple Events needs the
# entitlement. Without an identity the build is ad hoc, which Gatekeeper blocks on download.
if [ -n "${CODESIGN_IDENTITY:-}" ]; then
  echo "▸ Signing as $CODESIGN_IDENTITY"
  codesign --force --deep --options runtime --timestamp \
    --entitlements "$MAC/Packaging/Browsentic.entitlements" --sign "$CODESIGN_IDENTITY" "$APP"
else
  echo "▸ Signing (ad hoc — Gatekeeper will block this build when it is downloaded)"
  codesign --force --deep --sign - --timestamp=none "$APP"
fi
codesign --verify --verbose=2 "$APP"

echo "✓ $APP"
