# Variable schemas. Values live per-instance in instances/<name>.tfvars (the deployed one is
# instances/alwaysmap.tfvars); terraform.tfvars.example is the annotated template.
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
  type    = string
  default = "autoknow"
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

variable "custom_domain" {
  type        = string
  description = "Public hostname to map to the service (e.g. autoknow.alwaysmap.com). Requires the applying identity to be a verified owner of the parent domain, and a CNAME to ghs.googlehosted.com at the DNS host. Empty = run.app URL only."
  default     = ""
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
  description = "The human who owns this deployment: initial member + manager of the AutoKnow contributors group, and the business/developer/operator owner recorded on the App Hub application (apphub.tf)."
  default     = "dylan@alwaysmap.com"
}

# ---- Ingestion drain alarm (issue #38) ----
# Off by default; the app degrades honestly without it (see monitoring.tf). Enabling it
# also requires ingestion_alarm_email — a precondition enforces that at plan time.
variable "enable_ingestion_alarm" {
  type        = bool
  description = "Create the ingestion drain alarm (log-based backlog/quota metrics + Cloud Monitoring alert policies + email channel). Off by default; requires ingestion_alarm_email when true."
  default     = false
}

variable "ingestion_alarm_email" {
  type        = string
  description = "Email address that receives ingestion drain / quota-exhaustion alerts. Required when enable_ingestion_alarm = true. Never a secret; a plain destination address."
  default     = ""
}
