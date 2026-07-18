output "project_id" {
  value = google_project.autoknow.project_id
}

output "service_url" {
  description = "Public Cloud Run URL — the OAuth redirect + Chat App URL point here."
  value       = google_cloud_run_v2_service.app.uri
}

output "oauth_redirect_uri" {
  description = "Add this to the OAuth client's Authorized redirect URIs."
  value       = "${google_cloud_run_v2_service.app.uri}/api/auth/callback/google"
}

output "sql_connection_name" {
  description = "For --add-cloudsql-instances and the Cloud SQL Auth Proxy."
  value       = google_sql_database_instance.db.connection_name
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${google_project.autoknow.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "runtime_service_account" {
  value = google_service_account.run.email
}

output "wif_provider" {
  description = "For google-github-actions/auth (workload_identity_provider)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "ci_service_account" {
  value = google_service_account.ci.email
}
