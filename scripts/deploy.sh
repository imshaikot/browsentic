#!/usr/bin/env bash
# The whole deploy pipeline, run from this machine.
#
#   ./scripts/deploy.sh            preview deployment (a throwaway URL)
#   ./scripts/deploy.sh --prod     production, i.e. browsentic.com
#
# Nothing is built on Vercel's side: this builds locally, verifies, packs the
# result into the Build Output API format, and uploads finished files.
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="preview"
VERCEL_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --prod|--production) TARGET="production"; VERCEL_ARGS+=(--prod) ;;
    --preview) TARGET="preview" ;;
    *) VERCEL_ARGS+=("$arg") ;;
  esac
done

step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$1"; }

command -v vercel >/dev/null || { echo "vercel CLI not found — npm i -g vercel"; exit 1; }
vercel whoami >/dev/null 2>&1 || { echo "not logged in — run: vercel login"; exit 1; }

step "Building (eleventy + tailwind + verify)"
npm run build

step "Packing into Build Output API format"
node scripts/vercel-output.mjs

if [ ! -d .vercel ] || [ ! -f .vercel/project.json ]; then
  step "Linking this directory to a Vercel project"
  vercel link
fi

step "Deploying to $TARGET"
vercel deploy --prebuilt "${VERCEL_ARGS[@]}"

step "Done"
if [ "$TARGET" = "production" ]; then
  echo "Live at https://browsentic.com — check the sitemap resolves:"
  echo "  curl -sI https://browsentic.com/sitemap.xml | head -1"
fi
