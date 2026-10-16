#!/usr/bin/env bash
# Proves a Pages URL is serving the game build from this exact commit.
#
# A 200 with the word "snail" in it is not enough: the repository README
# rendered by Jekyll says "snail" too, and a Pages source left on branch
# serving publishes exactly that. So the page must be the Next export (game
# title, _next assets, no Jekyll markers) and the deploy-sha.txt stamped by
# the build must name this commit.
#
# Pages can take several minutes after the deploy step to serve new files
# (3.5 minutes on 16 Oct 2026), so the default window is 600 seconds of
# elapsed time. Each fetch is capped at 15 s, so a slow or hung Pages edge
# cannot stretch the job past the window by more than one try. A good
# deploy returns as soon as the stamp appears.
#
#   scripts/verify-pages.sh <page-url> <expected-sha> [window-seconds] [delay-seconds]
set -u

url="${1:?page url}"
sha="${2:?expected commit sha}"
window="${3:-600}"
delay="${4:-10}"
url="${url%/}/"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

reason=""
check() {
  local bust="v=${sha}-$1"
  local code
  code=$(curl -sSL -o "$work/page.html" -w '%{http_code}' --max-time 15 "${url}?${bust}") || true
  [ "$code" = "200" ] || { reason="page HTTP $code"; return 1; }
  grep -qi '<title>[^<]*Snail Racing' "$work/page.html" || { reason="page title is not the game"; return 1; }
  grep -q '/_next/static/' "$work/page.html" || { reason="page has no _next assets (not the Next export)"; return 1; }
  if grep -qiE 'anchor-js|jekyll|github-pages-theme|class="markdown-body"' "$work/page.html"; then
    reason="page is a Jekyll render (Pages source is serving the branch)"
    return 1
  fi
  code=$(curl -sSL -o "$work/sha.txt" -w '%{http_code}' --max-time 15 "${url}deploy-sha.txt?${bust}") || true
  [ "$code" = "200" ] || { reason="deploy-sha.txt HTTP $code"; return 1; }
  local live
  live="$(tr -d '[:space:]' < "$work/sha.txt")"
  [ "$live" = "$sha" ] || { reason="live build is ${live:-empty}, expected $sha"; return 1; }
  return 0
}

echo "Checking $url for build $sha (up to ${window}s)"
deadline=$((SECONDS + window))
attempt=0
while :; do
  attempt=$((attempt + 1))
  if check "$attempt"; then
    echo "Live: $url serves the game built from $sha (attempt $attempt)."
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      {
        echo "### Snail Race is live"
        echo ""
        echo "$url"
        echo ""
        echo "Serving the game built from \`$sha\`, verified on attempt $attempt."
      } >> "$GITHUB_STEP_SUMMARY"
    fi
    exit 0
  fi
  echo "Attempt $attempt: $reason."
  [ $((SECONDS + delay)) -lt "$deadline" ] || break
  sleep "$delay"
done
echo "::error::$url is not serving the game built from $sha after ${window}s ($attempt attempts): $reason."
exit 1
