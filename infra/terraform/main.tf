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
    "cloudresourcemanager.googleapis.com",
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

# ---- Artifact Registry ----
resource "google_artifact_registry_repository" "images" {
  project       = google_project.autoknow.project_id
  location      = var.region
  repository_id = "autoknow"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
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
  db_connection = google_sql_database_instance.db.connection_name
  # Unix-socket DSN via the Cloud SQL Auth Proxy mounted at /cloudsql.
  database_url = "postgresql://app:${random_password.db.result}@localhost/autoknow?host=/cloudsql/${local.db_connection}&schema=public"

  # Secret containers. `generated` ones get their version from TF; `external` ones are
  # populated out-of-band (gcloud, from the local .env) so no external secret is in TF.
  generated_secrets = {
    "database-url" = local.database_url
    "auth-secret"  = random_password.auth_secret.result
    "cron-secret"  = random_password.cron_secret.result
    "admin-token"  = random_password.admin_token.result
  }
  external_secrets = [
    "gemini-api-key",
    "auth-google-id",
    "auth-google-secret",
    "google-project-number",
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
      # Secret env — one block per secret
      dynamic "env" {
        for_each = {
          DATABASE_URL                 = "database-url"
          AUTH_SECRET                  = "auth-secret"
          CRON_SECRET                  = "cron-secret"
          ADMIN_TOKEN                  = "admin-token"
          GEMINI_API_KEY               = "gemini-api-key"
          AUTH_GOOGLE_ID               = "auth-google-id"
          AUTH_GOOGLE_SECRET           = "auth-google-secret"
          GOOGLE_PROJECT_NUMBER        = "google-project-number"
          GOOGLE_SERVICE_ACCOUNT_JSON  = "google-service-account-json"
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
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_secret_manager_secret_version.generated,
    google_project_iam_member.run_secrets,
    google_project_iam_member.run_sql,
  ]
}

# Public ingress: browsers and Google Chat both call it; app-layer auth is the boundary.
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = google_project.autoknow.project_id
  location = var.region
  name     = google_cloud_run_v2_service.app.name
  role     = "roles/run.invoker"
  member   = "allUsers"
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
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/iam.serviceAccountUser",
    "roles/cloudsql.client",
  ])
  project = google_project.autoknow.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.ci.email}"
}
