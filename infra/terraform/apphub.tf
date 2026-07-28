# ---- App Hub: one home for the app's runtime surface (issue #156 / bead autoknow-sc8) ----
#
# What this buys: Cloud Run, Cloud SQL and the secrets stop being a per-service hunt through
# the console and acquire a shared identity, with ownership and criticality declared rather
# than remembered.
#
# READ THIS BEFORE EXPECTING MORE: App Hub models SERVICES and WORKLOADS, and nothing else.
# The Scheduler job, the Artifact Registry repositories, the domain mapping, the monitoring
# policies, the service accounts and IAM, and the API enablements are all Terraform-managed
# and all structurally invisible here. That is a property of App Hub, not a gap to close —
# the honest scope is "the runtime surface", not "everything Terraform declares". Issue #156
# measured the discovery on 2026-07-25: 13 services visible, 6 categories not.
#
# THREE THINGS THAT DECIDE THE SHAPE BELOW (all measured in #156, quoted, not re-derived
# here — this session had no GCP credentials):
#   1. Discovery is per-location and ours is split: the Cloud Run service and the SQL
#      instance are discovered in us-central1, the secrets in `global`. So the Application
#      must be scope GLOBAL — a REGIONAL one could not hold the secrets.
#   2. `global` discovery is ~80% noise (a serviceusage entry per enabled API, plus urn:mcp
#      handles). Services are therefore named one by one, never registered in bulk.
#   3. Every discovered service is registrationType EXCLUSIVE — it can belong to exactly one
#      Application, ever. A console click-through would take ownership and then fight the
#      Terraform that is supposed to own it, which is why this exists in HCL from the start.
#
# The tfstate bucket is deliberately NOT registered: it is Terraform's own state, not a part
# of the running app, and registering it would put the tooling inside the thing it builds.
#
# One Application, environment PRODUCTION: there is exactly one instance (instances/
# alwaysmap.tfvars) and no workspace split. A dev environment would be a SECOND Application,
# because attributes are per-Application and EXCLUSIVE registration forbids sharing.

resource "google_apphub_application" "autoknow" {
  project        = google_project.autoknow.project_id
  location       = "global"
  application_id = "autoknow"
  display_name   = "AutoKnow"
  description    = "AI-maintained knowledge base for AlwaysMap — Cloud Run + Cloud SQL + Secret Manager. Declared in infra/terraform."

  scope {
    type = "GLOBAL" # not REGIONAL: the ten secrets live in `global` (see note 1 above)
  }

  attributes {
    environment {
      type = "PRODUCTION"
    }

    # The app is the team's knowledge base, not a revenue path: an outage is disruptive, not
    # an emergency. HIGH says that without crying wolf, and the alarm that would actually
    # page anyone is the ingestion one in monitoring.tf.
    criticality {
      type = "HIGH"
    }

    business_owners {
      display_name = "Dylan Thomas"
      email        = var.chat_group_owner
    }
    developer_owners {
      display_name = "Dylan Thomas"
      email        = var.chat_group_owner
    }
    operator_owners {
      display_name = "Dylan Thomas"
      email        = var.chat_group_owner
    }
  }

  depends_on = [google_project_service.apis]
}

# ---- The registered services ----
# Each `google_apphub_service` needs the DISCOVERED service's opaque handle
# (projects/…/discoveredServices/apphub-00000000-…), which is not a stable name you can type.
# The data sources below look each one up by its resource URI, so no generated id is pasted
# into HCL. A URI that matches nothing fails at PLAN time — the safe direction: nothing is
# created, and the fix is a one-line URI correction.

data "google_apphub_discovered_service" "run" {
  project     = google_project.autoknow.project_id
  location    = var.region
  service_uri = "//run.googleapis.com/projects/${google_project.autoknow.project_id}/locations/${var.region}/services/${var.service_name}"
}

data "google_apphub_discovered_service" "sql" {
  project     = google_project.autoknow.project_id
  location    = var.region
  service_uri = "//sqladmin.googleapis.com/projects/${google_project.autoknow.project_id}/instances/${google_sql_database_instance.db.name}"
}

# The ten secret containers, from the same list main.tf creates them from — so a secret added
# there is registered here without anyone remembering to.
data "google_apphub_discovered_service" "secret" {
  for_each    = toset(local.all_secret_ids)
  project     = google_project.autoknow.project_id
  location    = "global"
  service_uri = "//secretmanager.googleapis.com/projects/${google_project.autoknow.project_id}/secrets/${each.value}"
}

resource "google_apphub_service" "run" {
  project            = google_project.autoknow.project_id
  location           = google_apphub_application.autoknow.location
  application_id     = google_apphub_application.autoknow.application_id
  service_id         = "cloud-run-${var.service_name}"
  display_name       = "Cloud Run — ${var.service_name}"
  description        = "The app itself: browser UI, API routes, the Chat endpoint and the cron tick."
  discovered_service = data.google_apphub_discovered_service.run.name
}

resource "google_apphub_service" "sql" {
  project            = google_project.autoknow.project_id
  location           = google_apphub_application.autoknow.location
  application_id     = google_apphub_application.autoknow.application_id
  service_id         = "cloud-sql-${google_sql_database_instance.db.name}"
  display_name       = "Cloud SQL — ${google_sql_database_instance.db.name}"
  description        = "Postgres + pgvector. Reached over the Cloud SQL Auth Proxy; runtime connects as the DML-only app_runtime role."
  discovered_service = data.google_apphub_discovered_service.sql.name
}

resource "google_apphub_service" "secret" {
  for_each           = toset(local.all_secret_ids)
  project            = google_project.autoknow.project_id
  location           = google_apphub_application.autoknow.location
  application_id     = google_apphub_application.autoknow.application_id
  service_id         = "secret-${each.value}"
  display_name       = "Secret — ${each.value}"
  discovered_service = data.google_apphub_discovered_service.secret[each.value].name
}
