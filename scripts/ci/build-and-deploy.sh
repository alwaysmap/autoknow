#!/usr/bin/env bash
# Build the production image and roll a Cloud Run service to it.
# Env: IMAGE (repo path, no tag), GIT_SHA, INSTANCE_PROJECT, INSTANCE_REGION, INSTANCE_SERVICE.
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="${IMAGE:?set IMAGE}"
SHA="${GIT_SHA:?set GIT_SHA}"
PROJECT="${INSTANCE_PROJECT:?set INSTANCE_PROJECT}"
REGION="${INSTANCE_REGION:?set INSTANCE_REGION}"
SERVICE="${INSTANCE_SERVICE:?set INSTANCE_SERVICE}"

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

docker build --platform linux/amd64 --build-arg GIT_SHA="${SHA}" -t "${IMAGE}:${SHA}" -t "${IMAGE}:latest" .
docker push "${IMAGE}:${SHA}"
docker push "${IMAGE}:latest"

gcloud run services update "$SERVICE" \
  --image "${IMAGE}:${SHA}" \
  --project "$PROJECT" \
  --region "$REGION" \
  --quiet
