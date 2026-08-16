# AutoKnow on Cloud Run — a fresh project, provisioned end-to-end.
# Public Cloud Run service (browser + Chat both need public reach); the app's own
# auth is the boundary (next-auth AUTH_ALLOWED_DOMAIN, requireRouteAuth, Chat JWT,
# CRON_SECRET). See docs/DEPLOYMENT_GCP.md for the architecture and the IAP alternative.

# ---- project + billing ----
resource "google_project" "autoknow" {
  name            = "AutoKnow"
  project_id      = var.project_id
  org_id          = var.org_id
  billing_account = var.billing_account
  deletion_policy = "DELETE" # allow full teardown (budget hygiene)
}

# ---- APIs ----
locals {
  services = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "chat.googleapis.com",
    "drive.googleapis.com",         # background Drive doc ingestion (lib/driveSync, keyless SA token)
    "cloudidentity.googleapis.com", # the Workspace contributors group (Chat visibility)
    "storage.googleapis.com",       # remote Terraform state bucket
    # App Hub — the one home for the app's runtime surface (apphub.tf). It is already
    # ENABLED in prod because someone enabled it by hand; declaring it makes the enabled set
    # a consequence of this config rather than of who clicked what. Adopting an already-on
    # API only writes a state entry — and disable_on_destroy = false below means removing
    # the line later cannot turn it off underneath a live registration.
    "apphub.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "orgpolicy.googleapis.com",
    "serviceusage.googleapis.com", # quota/billing project for the orgpolicy provider alias
    # Modern Chat apps are add-on-framework apps; delivery requires the add-on
    # registration chain (OAuth consent screen + Marketplace SDK app config with
    # "Standalone Chat App" + private published listing — all console-only) and
    # these two APIs behind it. See docs/OPERATIONS.md §6 and the Chat runbook.
    "gsuiteaddons.googleapis.com",
    "appsmarket-component.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.services)
  project            = google_project.autoknow.project_id
  service            = each.value
  disable_on_destroy = false
}

data "google_project" "autoknow" {
  project_id = google_project.autoknow.project_id
  depends_on = [google_project_service.apis]
}

# ---- Remote Terraform state ----
# State lives in GCS (versioned) so it isn't trapped on one laptop and CI can read it.
# The backend is configured per-instance at init time (see instances/<name>.backend.hcl).
resource "google_storage_bucket" "tfstate" {
  project                     = google_project.autoknow.project_id
  name                        = "${var.project_id}-tfstate"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false
  versioning {
    enabled = true
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "ci_state" {
  bucket = google_storage_bucket.tfstate.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ci.email}"
}

# ---- Artifact Registry ----
resource "google_artifact_registry_repository" "images" {
  project       = google_project.autoknow.project_id
  location      = var.region
  repository_id = "autoknow"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

# ---- Docker Hub mirror (base images) ----
# Every deploy builds FROM a Node base image, and pulling it straight from Docker Hub puts
# an unauthenticated third party on the critical path of shipping. On 2026-07-27 that bill
# came due: the deploy of 26bf955 failed with `DeadlineExceeded: node:22-alpine: … dial tcp
# 34.236.73.184:443: i/o timeout` (GitHub Actions run 30227143377) AFTER the migrate job had
# already succeeded — prod sat on the old revision with new migrations applied, a split state
# the health endpoint cannot show you (AGENTS lesson 1: ask prod what sha it runs).
#
# A REMOTE repository is Artifact Registry proxying and caching upstream: the first pull of a
# digest fetches it from Docker Hub, every later pull is served from inside the project. So a
# Docker Hub outage stops being a deploy outage, and pulls stop counting against Docker Hub's
# anonymous rate limit.
#
# The Dockerfile is repointed at this mirror BY DIGEST — a moved tag cannot then change the
# runtime — in a separate app PR, because a combined one would deploy that Dockerfile before
# anyone had applied this (AGENTS infra ordering; bead autoknow-7dj).
#
# No IAM here on purpose: the CI service account already holds project-level
# roles/artifactregistry.writer (see google_project_iam_member.ci_roles), which includes the
# read this repository needs, and `gcloud auth configure-docker <region>-docker.pkg.dev` in
# scripts/ci/build-and-deploy.sh already authenticates the host that will pull it.
resource "google_artifact_registry_repository" "dockerhub" {
  project       = google_project.autoknow.project_id
  location      = var.region
  repository_id = "dockerhub"
  format        = "DOCKER"
  mode          = "REMOTE_REPOSITORY"
  description   = "Remote (proxy + cache) of Docker Hub, so a deploy does not depend on docker.io being reachable."

  remote_repository_config {
    description = "docker.io"
    docker_repository {
      public_repository = "DOCKER_HUB"
    }
  }

  depends_on = [google_project_service.apis]
}

# ---- Cloud SQL (Postgres + pgvector) ----
resource "google_sql_database_instance" "db" {
  project          = google_project.autoknow.project_id
  name             = "autoknow-pg"
  region           = var.region
  database_version = "POSTGRES_16"
  # Fresh project → safe to destroy; flip to true before real production data.
  deletion_protection = false

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE" # shared-core tiers (db-f1-micro) are ENTERPRISE-only
    availability_type = "ZONAL"
    disk_size         = 10
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled = true # reachable only via the Cloud SQL Auth Proxy (IAM), no authorized networks
    }
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "autoknow" {
  project  = google_project.autoknow.project_id
  name     = "autoknow"
  instance = google_sql_database_instance.db.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  project  = google_project.autoknow.project_id
  name     = "app"
  instance = google_sql_database_instance.db.name
  password = random_password.db.result
}

# Least-privilege RUNTIME role. Cloud SQL auto-grants cloudsqlsuperuser (→ DDL) to every
# API-created user, so `app` can't be demoted and a second Cloud SQL user is no better.
# Instead app_runtime is a plain SQL role (created by scripts/db/harden-roles.sql, run as
# `app` which has CREATEROLE) with row-DML only — NOT a cloudsqlsuperuser member, so it
# physically cannot run DDL / `prisma db push`. `app` stays the owner + migration role.
resource "random_password" "app_runtime" {
  length  = 32
  special = false
}

# ---- Service accounts ----
resource "google_service_account" "run" {
  project      = google_project.autoknow.project_id
  account_id   = "autoknow-run"
  display_name = "AutoKnow Cloud Run runtime"
}

resource "google_project_iam_member" "run_secrets" {
  project = google_project.autoknow.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_project_iam_member" "run_sql" {
  project = google_project.autoknow.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.run.email}"
}

resource "google_service_account" "scheduler" {
  project      = google_project.autoknow.project_id
  account_id   = "autoknow-scheduler"
  display_name = "AutoKnow Cloud Scheduler"
}

# ---- Keyless bot/Drive identity ----
# The Chat app authenticates as the Cloud Run runtime SA and mints chat.bot / drive
# tokens via the IAM Credentials API (no key material — see lib/googleAuth). That
# self-mint requires the SA to be able to impersonate itself.
resource "google_service_account_iam_member" "run_self_token" {
  service_account_id = google_service_account.run.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.run.email}"
}

# ---- Secrets ----
# Generated secrets: value lives in TF (standard for random_password).
resource "random_password" "auth_secret" {
  length  = 48
  special = false
}
resource "random_password" "cron_secret" {
  length  = 48
  special = false
}
resource "random_password" "admin_token" {
  length  = 32
  special = false
}

locals {
  # Cloud Run's stable, deterministic per-project URL (knowable before the service is
  # created — unlike the random-hash *.a.run.app alias — so it can pin AUTH_URL without
  # a self-reference). This is the canonical origin: register its callback in OAuth and
  # visit the app here.
  service_url = "https://${var.service_name}-${google_project.autoknow.number}.${var.region}.run.app"

  # Where users actually visit the app (and the Auth.js origin). The custom domain when
  # mapped, else the run.app URL. Both origins keep serving; OAuth needs a registered
  # redirect URI per origin.
  app_url = var.custom_domain != "" ? "https://${var.custom_domain}" : local.service_url

  db_connection = google_sql_database_instance.db.connection_name
  # Unix-socket DSN via the Cloud SQL Auth Proxy mounted at /cloudsql.
  # database-url = the `app` owner/migration role (used by CI `migrate deploy`).
  # runtime-database-url = the DML-only `app_runtime` role (used by Cloud Run at runtime).
  database_url         = "postgresql://app:${random_password.db.result}@localhost/autoknow?host=/cloudsql/${local.db_connection}&schema=public"
  runtime_database_url = "postgresql://app_runtime:${random_password.app_runtime.result}@localhost/autoknow?host=/cloudsql/${local.db_connection}&schema=public"

  # Audience of the JWTs Google Chat signs (verified in /api/chat/events): the NUMBER of the
  # project the Chat app is registered in. Normally this project — Terraform holds that
  # number, so it supplies the value rather than a human retyping it after each apply.
  # The override is the documented separate-project case (OPERATIONS §6 step 1) — still
  # supplied, from tfvars. ADR: docs/adr/2026-07-26-infra-owned-facts-are-supplied-or-unknown.md
  chat_project_number = var.chat_project_number != "" ? var.chat_project_number : google_project.autoknow.number

  # Secret containers. `generated` ones get their version from TF — random passwords, values
  # TF composes, and facts TF already knows; `external` ones are populated out-of-band
  # (gcloud, from the local .env) so no external secret is in TF.
  generated_secrets = {
    "database-url"          = local.database_url
    "runtime-database-url"  = local.runtime_database_url
    "auth-secret"           = random_password.auth_secret.result
    "cron-secret"           = random_password.cron_secret.result
    "admin-token"           = random_password.admin_token.result
    "google-project-number" = local.chat_project_number
  }
  external_secrets = [
    "gemini-api-key",
    "auth-google-id",
    "auth-google-secret",
    "google-service-account-json",
  ]
  all_secret_ids = concat(keys(local.generated_secrets), local.external_secrets)
}

resource "google_secret_manager_secret" "s" {
  for_each  = toset(local.all_secret_ids)
  project   = google_project.autoknow.project_id
  secret_id = each.value
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "generated" {
  for_each    = local.generated_secrets
  secret      = google_secret_manager_secret.s[each.key].id
  secret_data = each.value
}


# ---- Chat contributors group ----
# Google Chat's Configuration page has no "everyone in domain" toggle (that needs a
# Marketplace listing); it only accepts specific people/groups. So we create a group and
# enter it in the Visibility box — add contributors here to grant Chat access. Managed via
# the Cloud Identity API through the user-project-quota provider alias (needs the
# X-Goog-User-Project header, same as org policy).
resource "google_cloud_identity_group" "contrib" {
  provider     = google.orgpolicy
  display_name = "AutoKnow Contributors"
  description  = "Members may add / @mention the AutoKnow Chat app and contribute context (plan §7b)."
  parent       = "customers/${var.workspace_customer_id}"

  group_key {
    id = "autoknow-contrib@${var.allowed_domain}"
  }

  # Marks it a normal Google Group (discussion forum), so it shows in Directory/Admin.
  labels = {
    "cloudidentity.googleapis.com/groups.discussion_forum" = ""
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_identity_group_membership" "contrib_owner" {
  provider = google.orgpolicy
  group    = google_cloud_identity_group.contrib.id

  preferred_member_key {
    id = var.chat_group_owner
  }
  roles { name = "MEMBER" }
  roles { name = "MANAGER" }
}

# ---- Friendly Drive/identity address ----
# A service account can't have a vanity @domain email, so expose a clean address people
# share Drive docs with via a group that CONTAINS the runtime SA. Sharing a doc with the
# group grants its members — including the SA — access, so the app reads it with its own
# keyless token, while users only ever see autoknow@<domain>.
resource "google_cloud_identity_group" "share" {
  provider     = google.orgpolicy
  display_name = "AutoKnow"
  description  = "Share Google Docs/folders with this address so AutoKnow can read them."
  parent       = "customers/${var.workspace_customer_id}"

  group_key {
    id = "autoknow@${var.allowed_domain}"
  }

  labels = {
    "cloudidentity.googleapis.com/groups.discussion_forum" = ""
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_identity_group_membership" "share_sa" {
  provider = google.orgpolicy
  group    = google_cloud_identity_group.share.id

  preferred_member_key {
    id = google_service_account.run.email
  }
  roles { name = "MEMBER" }
}

# ---- Cloud Run service ----
resource "google_cloud_run_v2_service" "app" {
  project             = google_project.autoknow.project_id
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account = google_service_account.run.email
    timeout         = "300s" # bounded cron tick (drive + refresh + summaries, all capped)
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    containers {
      image = var.image != "" ? var.image : "us-docker.pkg.dev/cloudrun/container/hello"
      ports { container_port = 3000 }

      # Plain env
      env {
        name  = "AUTH_ALLOWED_DOMAIN"
        value = var.allowed_domain
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      # Pin Auth.js's origin to the public URL. Without it, behind the Cloud Run proxy
      # Auth.js falls back to the container's HOSTNAME (0.0.0.0:3000) and OAuth callbacks
      # break with error=Configuration.
      env {
        name  = "AUTH_URL"
        value = local.app_url
      }
      # Keyless Google auth: names the runtime SA so lib/googleAuth can mint chat.bot /
      # drive tokens for it via IAM Credentials (no GOOGLE_SERVICE_ACCOUNT_JSON key).
      env {
        name  = "GOOGLE_SA_EMAIL"
        value = google_service_account.run.email
      }
      # Friendly address the app tells users to share Drive docs with (a group the SA is
      # a member of) instead of the raw *.iam.gserviceaccount.com email.
      env {
        name  = "GOOGLE_SHARE_ADDRESS"
        value = google_cloud_identity_group.share.group_key[0].id
      }
      # The Scheduler cadence, told to the app rather than assumed by it. Every Gemini cap
      # in lib/ingestBudget is a daily budget divided by cycles-per-day, so a schedule that
      # runs more often than the app assumes multiplies real spend while the settings
      # slider keeps plotting the old ceiling — a quota cap reachable by editing the line
      # below and nothing else. `var.cron_schedule` stays the single source; this only
      # stops it being invisible to the code that depends on it.
      # ADR: docs/adr/2026-07-26-infra-owned-facts-are-supplied-or-unknown.md
      env {
        name  = "REFRESH_CRON_SCHEDULE"
        value = var.cron_schedule
      }
      # Secret env — one block per secret
      dynamic "env" {
        for_each = {
          # Runtime uses the DML-only app_runtime role (no DDL). Migrations use `app`
          # (database-url) only in CI. See scripts/db/harden-roles.sql.
          DATABASE_URL          = "runtime-database-url"
          AUTH_SECRET           = "auth-secret"
          CRON_SECRET           = "cron-secret"
          ADMIN_TOKEN           = "admin-token"
          GEMINI_API_KEY        = "gemini-api-key"
          AUTH_GOOGLE_ID        = "auth-google-id"
          AUTH_GOOGLE_SECRET    = "auth-google-secret"
          GOOGLE_PROJECT_NUMBER = "google-project-number"
          # GOOGLE_SERVICE_ACCOUNT_JSON intentionally omitted: keyless (Workload Identity)
          # auth is used instead — see GOOGLE_SA_EMAIL + run_self_token above. The secret
          # container still exists for the key-file fallback path but isn't mounted here.
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.s[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.db_connection]
      }
    }
  }

  # App deploys update the image via gcloud/CI; don't let Terraform fight them.
  # Service-level `scaling` is an API-managed block we don't set (autoscaling is
  # configured under template.scaling); ignore it so plans stay a clean no-op.
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      scaling,
      # `gcloud run deploy` (image swaps) stamps these client tags; ignore them so a
      # deploy never shows as Terraform drift.
      client,
      client_version,
    ]
  }

  depends_on = [
    google_secret_manager_secret_version.generated,
    google_project_iam_member.run_secrets,
    google_project_iam_member.run_sql,
  ]
}

# The org enforces Domain Restricted Sharing (iam.allowedPolicyMemberDomains), which
# blocks allUsers. Scope an exception to THIS project so the service is publicly
# reachable; alwaysmap.com-only access is still enforced at the app layer (next-auth
# AUTH_ALLOWED_DOMAIN, fail-closed routes, Chat JWT, CRON_SECRET). Managed via the
# orgpolicy provider alias (needs a quota/billing project).

# Enabling an API and immediately using it is eventually-consistent; wait before the
# orgpolicy alias (which bills to this project) makes its first call.
resource "time_sleep" "wait_apis" {
  depends_on      = [google_project_service.apis]
  create_duration = "60s"
}

resource "google_org_policy_policy" "allow_public_invoker" {
  provider = google.orgpolicy
  name     = "projects/${google_project.autoknow.number}/policies/iam.allowedPolicyMemberDomains"
  parent   = "projects/${google_project.autoknow.number}"
  spec {
    rules {
      allow_all = "TRUE"
    }
  }
  depends_on = [time_sleep.wait_apis]
}

# Org-policy changes propagate asynchronously; the allUsers binding is rejected until
# the exception lands. This deterministic wait replaces an imperative retry loop.
resource "time_sleep" "wait_policy" {
  depends_on      = [google_org_policy_policy.allow_public_invoker]
  create_duration = "90s"
}

# Public ingress: browsers and Google Chat both call it; app-layer auth is the boundary.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = google_project.autoknow.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"

  depends_on = [time_sleep.wait_policy]
}

# ---- Cloud Scheduler → the AI-update pipeline ----
resource "google_cloud_scheduler_job" "refresh" {
  project   = google_project.autoknow.project_id
  region    = var.region
  name      = "autoknow-refresh"
  schedule  = var.cron_schedule
  time_zone = "Etc/UTC"

  http_target {
    http_method = "GET"
    uri         = "${google_cloud_run_v2_service.app.uri}/api/cron/refresh"
    headers = {
      Authorization = "Bearer ${random_password.cron_secret.result}"
    }
  }
  depends_on = [google_project_service.apis]
}

# ---- Custom domain ----
# autoknow.alwaysmap.com. DNS for alwaysmap.com lives in Squarespace's UI (no API —
# deliberate choice over migrating the org email domain's zone here), so the required
# CNAME (autoknow → ghs.googlehosted.com, Cloud Run's shared front end for subdomain
# mappings) is a manual record there, not Terraform. The mapping below gives free
# managed TLS (vs ~$18/mo for a load balancer) and requires the applying identity to
# be a verified Search Console owner of alwaysmap.com (dylan@ is, via the
# Workspace-era google-site-verification TXT on the zone apex).
resource "google_cloud_run_domain_mapping" "app" {
  count    = var.custom_domain != "" ? 1 : 0
  project  = google_project.autoknow.project_id
  location = var.region
  name     = var.custom_domain

  metadata {
    namespace = google_project.autoknow.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.app.name
  }
}

# ---- Workload Identity Federation (keyless GitHub Actions deploys) ----
resource "google_iam_workload_identity_pool" "github" {
  project                   = google_project.autoknow.project_id
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = google_project.autoknow.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"
  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }
  attribute_condition = "assertion.repository == '${var.github_repo}'"
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "ci" {
  project      = google_project.autoknow.project_id
  account_id   = "autoknow-ci"
  display_name = "AutoKnow GitHub Actions deployer"
}

resource "google_service_account_iam_member" "ci_wif" {
  service_account_id = google_service_account.ci.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

resource "google_project_iam_member" "ci_roles" {
  for_each = toset([
    "roles/run.admin",               # deploy new revisions
    "roles/artifactregistry.writer", # push images
    "roles/iam.serviceAccountUser",  # deploy runs the service as the runtime SA
    "roles/cloudsql.client",
    "roles/viewer", # read-only, lets `terraform plan` run in CI (apply stays human)
  ])
  project = google_project.autoknow.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ci.email}"
}

# The CI migrate/harden jobs read ONLY the DB connection secrets (scoped, not project-wide):
# database-url (app, for migrations + creating the runtime role) and runtime-database-url
# (to verify app_runtime is DML-only).
resource "google_secret_manager_secret_iam_member" "ci_db_url" {
  for_each  = toset(["database-url", "runtime-database-url"])
  secret_id = google_secret_manager_secret.s[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ci.email}"
}
