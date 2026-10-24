#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

docker build -q -f backend/Dockerfile -t aeza-backend-oidc-hackathon-check .
docker run --rm --network none \
  -e OIDC_ISSUER_URL= \
  -e OIDC_CLIENT_ID= \
  -e OIDC_CLIENT_SECRET= \
  -e OIDC_CALLBACK_URL= \
  -e OIDC_ALLOWED_SUB= \
  -e OIDC_SESSION_SECRET= \
  aeza-backend-oidc-hackathon-check \
  python -m pytest -q tests/test_oidc_hackathon.py
