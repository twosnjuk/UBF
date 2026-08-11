#!/usr/bin/env bash
#
# Deploy the Utah Brazilian Festival site.
#
# Usage:
#   ./deploy.sh
#
# What it does:
#   1. Uploads the site files to the S3 bucket (skips tooling + junk).
#   2. Invalidates the CloudFront cache.
#   3. Purges the Cloudflare cache (Cloudflare sits in front of CloudFront, so
#      updated files stay stale until Cloudflare is purged too).
#
# Requirements:
#   - AWS CLI configured (`aws configure`).
#   - For the Cloudflare purge: export CF_API_TOKEN with a token that has
#     "Zone -> Cache Purge" (and "Zone -> Zone -> Read" so the Zone ID can be
#     looked up automatically). Alternatively export CF_ZONE_ID to skip lookup.
#     If CF_API_TOKEN is not set, the Cloudflare purge is skipped (non-fatal).
#
# The Cloudflare Worker (worker/) is deployed separately with `wrangler deploy`
# and is intentionally NOT uploaded to S3.

set -euo pipefail

BUCKET="vivabrazil-bucket"
DIST_ID="E1BLRLJ1NISI0O"
DOMAIN="utahbrazilianfestival.com"

# Run from the folder this script lives in, so paths are correct no matter
# where it's invoked from.
cd "$(dirname "$0")"

echo "==> Uploading site to s3://${BUCKET}/ ..."
aws s3 sync . "s3://${BUCKET}/" \
  --exclude ".*" \
  --exclude ".*/*" \
  --exclude "worker/*" \
  --exclude "deploy.sh"

echo "==> Invalidating CloudFront cache (${DIST_ID}) ..."
aws cloudfront create-invalidation \
  --distribution-id "${DIST_ID}" \
  --paths "/*" \
  --query "Invalidation.{Id:Id, Status:Status}" \
  --output table

echo "==> Purging Cloudflare cache ..."
if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "    Skipped: CF_API_TOKEN not set (export it to enable Cloudflare purge)."
else
  zone_id="${CF_ZONE_ID:-}"
  if [ -z "${zone_id}" ]; then
    # Look up the Zone ID from the domain name (needs Zone:Read on the token).
    zone_id="$(curl -s "https://api.cloudflare.com/client/v4/zones?name=${DOMAIN}" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      | grep -o '"id":"[0-9a-f]\{32\}"' | head -1 | cut -d'"' -f4 || true)"
  fi

  if [ -z "${zone_id}" ]; then
    echo "    WARN: could not determine Cloudflare Zone ID."
    echo "          Give the token Zone:Read, or export CF_ZONE_ID. Skipping purge."
  else
    resp="$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}' || true)"
    if echo "${resp}" | grep -q '"success":true'; then
      echo "    Cloudflare cache purged (zone ${zone_id})."
    else
      echo "    WARN: Cloudflare purge failed: ${resp}"
    fi
  fi
fi

echo "==> Done. Changes go live within ~1-5 min (CloudFront invalidation)."
