#!/usr/bin/env bash
# Terraform for the AutoKnow stack, with the identity trap closed.
#
#   npm run infra:plan            # read-only
#   npm run infra:apply           # human-run, prompts before changing anything
#   npm run infra:plan -- -target=…   # extra args pass through
#
# THE TRAP. `.env` sets GOOGLE_APPLICATION_CREDENTIALS to the app's Drive service-account
# key, and the Google Terraform provider prefers that over your gcloud ADC. So any shell
# that has sourced .env — which is most shells in this repo — authenticates Terraform as
# the RUNTIME service account rather than as you. That SA correctly has no access to the
# state bucket, and the failure it produces is:
#
#   Error 403: autoknow@….iam.gserviceaccount.com does not have storage.objects.list
#   access to the bucket … (or it may not exist)
#
# which reads as a missing bucket or a broken backend, not as "you are the wrong
# principal". It cost a real debugging detour. Unsetting the variable is the whole fix;
# asserting the identity afterwards is what stops the next variant of it being a mystery
# (AGENTS lesson 2 — enforce it, don't write it down).
set -euo pipefail
cd "$(dirname "$0")/../../infra/terraform"

INSTANCE="${INSTANCE:-alwaysmap}"
# Who Terraform must be. A human in the Workspace, never a service account: this stack
# manages org policy, Cloud Identity groups and IAM, which is exactly why the terraform
# workflow says apply is human-run.
EXPECTED_DOMAIN="${TF_IDENTITY_DOMAIN:-alwaysmap.com}"

# 1. Take the app's credentials out of the picture, whatever the shell believes.
unset GOOGLE_APPLICATION_CREDENTIALS GOOGLE_CREDENTIALS GOOGLE_OAUTH_ACCESS_TOKEN

# 2. Prove who we are BEFORE touching the backend, so a wrong identity fails with a
#    sentence instead of a 403 about a bucket.
token="$(gcloud auth application-default print-access-token 2>/dev/null || true)"
if [ -z "$token" ]; then
  echo "terraform: no Application Default Credentials." >&2
  echo "  Run: gcloud auth application-default login" >&2
  exit 1
fi

# Bearer header, not a ?access_token= query string — tokens do not belong in URLs, which
# land in proxy and access logs.
identity="$(curl -fsS -H "Authorization: Bearer ${token}" \
  https://www.googleapis.com/oauth2/v3/userinfo 2>/dev/null \
  | sed -n 's/.*"email"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ -z "$identity" ]; then
  echo "terraform: ADC is not a user credential (userinfo returned no email)." >&2
  echo "  A service-account ADC cannot administer this stack — apply is human-run." >&2
  echo "  Run: gcloud auth application-default login" >&2
  exit 1
fi

case "$identity" in
  *"@${EXPECTED_DOMAIN}")
    ;;
  *)
    echo "terraform: ADC is ${identity}, expected an @${EXPECTED_DOMAIN} account." >&2
    echo "  Google defaults multi-login sessions to the wrong account (AGENTS.md)." >&2
    echo "  Run: gcloud auth application-default login   (and pick the right one)" >&2
    echo "  Override deliberately with: TF_IDENTITY_DOMAIN=<domain> npm run infra:plan" >&2
    exit 1
    ;;
esac

echo "terraform: ${identity} · instance ${INSTANCE}"

# 3. Backend + tfvars come from the instance, so neither is a thing to remember.
terraform init -backend-config="instances/${INSTANCE}.backend.hcl" -input=false >/dev/null

cmd="${1:?usage: terraform.sh <plan|apply|output|…> [args]}"
shift || true
case "$cmd" in
  plan | apply | destroy)
    exec terraform "$cmd" -var-file="instances/${INSTANCE}.tfvars" "$@"
    ;;
  *)
    exec terraform "$cmd" "$@"
    ;;
esac
