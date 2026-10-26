#!/usr/bin/env bash
# Build the static game and publish it to Cloudflare Workers, without GitHub
# Actions. Needs CLOUDFLARE_API_TOKEN (Workers Scripts: Edit) and
# CLOUDFLARE_ACCOUNT_ID in the environment, or a `wrangler login` session.
#
#   bash scripts/deploy-cloudflare.sh            build and deploy
#   bash scripts/deploy-cloudflare.sh --dry-run  build and check, no upload
#
# For another club, name the club and give its Worker its own name:
#
#   CLUB=<id> WORKER_NAME=<id>-snailrace bash scripts/deploy-cloudflare.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# Static hosting cannot run the API routes; set them aside for the build and
# always put them back.
stash="$(mktemp -d)"
restore() { if [ -d "$stash/api" ]; then rm -rf app/api; mv "$stash/api" app/api; fi; rmdir "$stash" 2>/dev/null || true; }
trap restore EXIT
mv app/api "$stash/api"

rm -rf out .next
STATIC_EXPORT=true npm run build
restore
trap - EXIT

git rev-parse HEAD > out/deploy-sha.txt
cat > out/_headers <<'HEADERS'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
HEADERS

npx --yes wrangler@4.152.0 deploy --config wrangler.site.jsonc --name "${WORKER_NAME:-snailrace}" "$@"
