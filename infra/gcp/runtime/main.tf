terraform {
  required_version = ">= 1.8, < 2.0"
  required_providers {
    google = { source = "hashicorp/google", version = "7.46.1" }
  }
}

variable "project_id" { type = string }
variable "region" {
  type    = string
  default = "southamerica-east1"
}
variable "image_uri" {
  type = string
  validation {
    condition     = can(regex("^southamerica-east1-docker\\.pkg\\.dev/farejo-510021/farejo-scraper/scraper@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "Use o digest imutável de uma imagem Farejo testada."
  }
}
variable "release_id" {
  type    = string
  default = "bootstrap"
}
variable "source_sha" {
  type    = string
  default = "bootstrap"
}

provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
  request_reason        = "farejo-release-${var.release_id}"
}

locals {
  secret_ids = {
    SUPABASE_URL                = "farejo-scraper-supabase-url"
    SUPABASE_SERVICE_ROLE_KEY   = "farejo-scraper-supabase-service-role-key"
    CATALOG_INVALIDATION_URL    = "farejo-scraper-catalog-invalidation-url"
    CATALOG_INVALIDATION_SECRET = "farejo-scraper-catalog-invalidation-secret"
  }
}

resource "google_cloud_run_v2_job" "scraper" {
  project             = var.project_id
  name                = "farejo-scraper"
  location            = var.region
  deletion_protection = true
  labels              = { release_id = var.release_id, source_sha = var.source_sha }
  template {
    task_count  = 1
    parallelism = 1
    template {
      service_account = "farejo-scraper-runner@${var.project_id}.iam.gserviceaccount.com"
      timeout         = "5400s"
      max_retries     = 0
      containers {
        image = var.image_uri
        resources {
          limits = { cpu = "1", memory = "2Gi" }
        }
        env {
          name  = "SCRAPE_PLATFORM"
          value = "all"
        }
        env {
          name  = "SCRAPE_TIER"
          value = "active"
        }
        env {
          name  = "SCRAPE_RUNNER"
          value = "cloud-run"
        }
        dynamic "env" {
          for_each = local.secret_ids
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value
                version = "1"
              }
            }
          }
        }
      }
    }
  }
  lifecycle { prevent_destroy = true }
}

resource "google_cloud_scheduler_job" "scraper" {
  project          = var.project_id
  region           = var.region
  name             = "farejo-scrape-0900-brt"
  description      = "Dispara a coleta active-only do Farejo às 09h de São Paulo."
  schedule         = "0 9 * * *"
  time_zone        = "America/Sao_Paulo"
  attempt_deadline = "320s"
  paused           = false
  retry_config { retry_count = 0 }
  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/farejo-scraper:run"
    oauth_token {
      service_account_email = "farejo-scraper-scheduler@${var.project_id}.iam.gserviceaccount.com"
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }
  depends_on = [google_cloud_run_v2_job.scraper]
  lifecycle { prevent_destroy = true }
}

output "image_uri" { value = google_cloud_run_v2_job.scraper.template[0].template[0].containers[0].image }
