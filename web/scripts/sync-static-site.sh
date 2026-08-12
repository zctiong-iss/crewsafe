#!/usr/bin/env bash
set -euo pipefail

: "${WEB_BUCKET:?WEB_BUCKET is required}"
[[ -f dist/index.html ]] || {
  echo "dist/index.html is missing; run the production build first" >&2
  exit 1
}

aws s3 sync dist "s3://${WEB_BUCKET}" \
  --delete \
  --exclude "index.html" \
  --cache-control "public, max-age=31536000, immutable"

aws s3 cp dist/index.html "s3://${WEB_BUCKET}/index.html" \
  --cache-control "no-store"