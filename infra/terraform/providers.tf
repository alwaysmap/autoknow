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
  region = var.region
}

provider "google-beta" {
  region = var.region
}
