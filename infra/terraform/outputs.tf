output "project_id" {
  value = google_project.autoknow.project_id
}

output "service_url" {
  description = "Canonical public Cloud Run URL (== AUTH_URL) — visit the app and point Chat here."
  value       = local.service_url
}

output "service_url_alias" {
  description = "The random-hash alias Cloud Run also serves the app on (informational)."
  value       = google_cloud_run_v2_service.app.uri
}

output "app_url" {
  description = "Where users visit the app (custom domain when mapped, else the run.app URL) — == AUTH_URL."
  value       = local.app_url
}

output "oauth_redirect_uris" {
  description = "Add these to the OAuth client's Authorized redirect URIs (one per serving origin)."
  value       = distinct(["${local.service_url}/api/auth/callback/google", "${local.app_url}/api/auth/callback/google"])
}

output "domain_mapping_dns" {
  description = "DNS records the mapping requires (maintained manually in Squarespace's DNS UI)."
  value       = try(google_cloud_run_domain_mapping.app[0].status[0].resource_records, [])
}

output "sql_connection_name" {
  description = "For --add-cloudsql-instances and the Cloud SQL Auth Proxy."
  value       = google_sql_database_instance.db.connection_name
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${google_project.autoknow.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "artifact_registry_dockerhub" {
  description = "Base-image mirror: prefix a Docker Hub path with this (e.g. …/library/node@sha256:…) so builds never call docker.io."
  value       = "${var.region}-docker.pkg.dev/${google_project.autoknow.project_id}/${google_artifact_registry_repository.dockerhub.repository_id}"
}

output "runtime_service_account" {
  value = google_service_account.run.email
}

output "chat_service_account" {
  description = "Register this SA in the Google Chat API config; share Drive docs with it (keyless — it's the Cloud Run runtime SA)."
  value       = google_service_account.run.email
}

output "chat_contributors_group" {
  description = "Enter this group in the Chat app's Visibility box; add contributors to it to grant Chat access."
  value       = google_cloud_identity_group.contrib.group_key[0].id
}

output "drive_share_address" {
  description = "Friendly address to share Google Docs/folders with (a group containing the app SA)."
  value       = google_cloud_identity_group.share.group_key[0].id
}

output "wif_provider" {
  description = "For google-github-actions/auth (workload_identity_provider)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "ci_service_account" {
  value = google_service_account.ci.email
}
