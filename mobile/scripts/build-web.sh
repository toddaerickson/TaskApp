#!/usr/bin/env bash
# Vercel build entry point. Two jobs:
#   1. `npx expo export --platform web` produces the static bundle in dist/.
#   2. Replace the service-worker cache version in dist/sw.js with a
#      build-unique tag so each deploy invalidates the prior cache. The
#      hardcoded `taskapp-v1` in mobile/public/sw.js was a footgun:
#      shipping a JS bundle without remembering to bump the version
#      string left iOS Safari PWA users on the stale shell forever.
#
# Tag source priority:
#   - VERCEL_GIT_COMMIT_SHA (set automatically by Vercel)
#   - GITHUB_SHA (local github actions / manual builds)
#   - `git rev-parse --short HEAD` (local dev)
#   - "dev" fallback
#
# The replacement is a single `sed` against the only source-of-truth
# token in dist/sw.js. Idempotent on rerun.

set -euo pipefail

npx expo export --platform web

if [[ -n "${VERCEL_GIT_COMMIT_SHA:-}" ]]; then
  TAG="${VERCEL_GIT_COMMIT_SHA:0:12}"
elif [[ -n "${GITHUB_SHA:-}" ]]; then
  TAG="${GITHUB_SHA:0:12}"
elif command -v git >/dev/null 2>&1 && git rev-parse --short HEAD >/dev/null 2>&1; then
  TAG="$(git rev-parse --short HEAD)"
else
  TAG="dev"
fi

if [[ -f dist/sw.js ]]; then
  sed -i.bak "s|taskapp-v1|taskapp-${TAG}|g" dist/sw.js
  rm -f dist/sw.js.bak
  echo "Service worker cache version: taskapp-${TAG}"
else
  echo "WARN: dist/sw.js not found; skipping cache-version stamp" >&2
fi
