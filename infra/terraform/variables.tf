# Variable schemas (values live in terraform.tfvars — see terraform.tfvars.example).
# Secrets are NOT variables here: secret *containers* are created by Terraform and
# their *values* are populated out-of-band (gcloud, from the local .env) so no secret
# ever lands in a .tf/.tfvars file or state as plaintext input.

variable "project_id" {
  type        = string
  description = "The GCP project id to CREATE for this deployment (globally unique)."
}

variable "billing_account" {
  type        = string
  description = "Billing account id to link (gcloud billing accounts list)."
}

variable "org_id" {
  type        = string
  description = "Organization id to create the project under (AlwaysMap)."
  default     = "1043306095275"
}

variable "region" {
  type        = string
  description = "Region for Cloud Run, Cloud SQL, Artifact Registry, Scheduler."
  default     = "us-central1"
}

variable "service_name" {
  type        = string
  default     = "autoknow"
}

variable "image" {
  type        = string
  description = "Full image ref to deploy (Artifact Registry). Set by CI or the deploy script."
  default     = "" # empty on first apply → a hello placeholder is used until the real image is pushed
}

variable "allowed_domain" {
  type        = string
  description = "Workspace domain allowed to sign in (AUTH_ALLOWED_DOMAIN)."
  default     = "alwaysmap.com"
}

variable "db_tier" {
  type        = string
  description = "Cloud SQL machine type. Smallest shared-core to protect budget."
  default     = "db-f1-micro"
}

variable "cron_schedule" {
  type        = string
  description = "Cloud Scheduler cron for the AI-update pipeline."
  default     = "0 * * * *" # hourly
}

variable "github_repo" {
  type        = string
  description = "owner/name for Workload Identity Federation (keyless CI deploys)."
  default     = "alwaysmap/autoknow"
}

variable "workspace_customer_id" {
  type        = string
  description = "Google Workspace customer ID (gcloud organizations list → DIRECTORY_CUSTOMER_ID)."
  default     = "C03ln3mj4"
}

variable "chat_group_owner" {
  type        = string
  description = "Initial member + manager of the AutoKnow contributors group."
  default     = "dylan@alwaysmap.com"
}
