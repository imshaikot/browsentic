#!/usr/bin/env bash
# Wraps dist/mac/Browsentic.app in a compressed disk image with an Applications shortcut.
set -euo pipefail

MAC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$MAC/../.." && pwd)"
DIST="$REPO/dist/mac"
APP="$DIST/Browsentic.app"

[ -d "$APP" ] || { echo "Build the app first: yarn mac:app" >&2; exit 1; }
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
DMG="$DIST/Browsentic-$VERSION.dmg"
STAGING="$DIST/dmg-staging"

rm -rf "$STAGING" "$DMG"
mkdir -p "$STAGING"
cp -R "$APP" "$STAGING/"
ln -s /Applications "$STAGING/Applications"
cp "$MAC/Packaging/dmg-readme.txt" "$STAGING/Read Me.txt"

hdiutil create -volname "Browsentic $VERSION" -srcfolder "$STAGING" -ov -format UDZO -fs HFS+ "$DMG" >/dev/null
rm -rf "$STAGING"

# With Apple credentials in the environment the image is signed, notarized and stapled, which is
# what makes it open on someone else's Mac without a Gatekeeper dialog.
if [ -n "${CODESIGN_IDENTITY:-}" ] && [ -n "${APPLE_ID:-}" ] && [ -n "${APPLE_TEAM_ID:-}" ] && [ -n "${APPLE_APP_PASSWORD:-}" ]; then
  echo "▸ Notarizing (this waits on Apple, usually a few minutes)"
  codesign --force --timestamp --sign "$CODESIGN_IDENTITY" "$DMG"
  xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
  xcrun stapler staple "$DMG"
else
  echo "! not notarized: set CODESIGN_IDENTITY, APPLE_ID, APPLE_TEAM_ID and APPLE_APP_PASSWORD to notarize"
fi
echo "✓ $DMG"
