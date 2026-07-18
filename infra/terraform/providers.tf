# Providers. Auth is Application Default Credentials (gcloud auth application-default
# login), so no key files. Versions pinned per the terraforming-101 convention.
terraform {
  required_version = ">= 1.7"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.20"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.20"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    time = {
      source  = "hashicorp/time"
      version = "~> 0.11"
    }
  }

  # State: local for the bootstrap apply (a fresh project has no bucket yet). After the
  # first apply creates the state bucket, migrate with:
  #   terraform init -migrate-state -backend-config="bucket=<project>-tfstate"
  # and uncomment the block below.
  # backend "gcs" {
  #   prefix = "autoknow"
  # }
}

provider "google" {
  # project is set per-resource where needed; the created project isn't the auth project.
  # No user_project_override here: during bootstrap the quota project (the one being
  # created) doesn't yet have serviceusage usable as a billing project, and overriding
  # globally breaks the project/API-enable calls.
  region = var.region
}

# Aliased provider used ONLY for org-policy resources, which bill quota to a "user
# project" and therefore need user_project_override. Scoping the override to this alias
# keeps it away from the bootstrap calls (project create, API enablement) that break
# under it. By the time an org-policy resource is created, its APIs are already enabled
# on the target project, so the override is safe.
provider "google" {
  alias                 = "orgpolicy"
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true
}

provider "google-beta" {
  region = var.region
}
