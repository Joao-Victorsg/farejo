variable "project_id" {
  description = "ID do projeto Google Cloud do scraper Farejo."
  type        = string
}

variable "billing_account_id" {
  description = "ID da conta de faturamento para criar o alerta mensal de US$ 1."
  type        = string
}

variable "region" {
  description = "Região do Cloud Run, próxima ao Supabase de produção."
  type        = string
  default     = "southamerica-east1"
}

variable "image_uri" {
  description = "Imagem imutável do scraper no Artifact Registry; deixe vazia no bootstrap inicial."
  type        = string
  default     = ""
}

variable "enable_job" {
  description = "Cria o Cloud Run Job após a imagem e os segredos existirem."
  type        = bool
  default     = false
}

variable "enable_scheduler" {
  description = "Ativa o disparo diário somente após o canário manual passar."
  type        = bool
  default     = false
}

variable "schedule" {
  description = "Horário local do Cloud Scheduler em sintaxe Unix cron."
  type        = string
  default     = "0 9 * * *"
}

variable "time_zone" {
  description = "Fuso horário IANA aplicado ao agendamento diário."
  type        = string
  default     = "America/Sao_Paulo"
}

variable "monthly_budget_brl" {
  description = "Alerta de orçamento mensal em BRL, moeda da conta de faturamento; notifica, mas não limita gastos."
  type        = number
  default     = 5.20
}

variable "budget_notification_channels" {
  description = "IDs opcionais dos canais de notificação do Cloud Monitoring."
  type        = list(string)
  default     = []
}

variable "budget_enable_project_recipients" {
  description = "Também envia alertas aos membros com acesso ao projeto."
  type        = bool
  default     = true
}

variable "artifact_cleanup_dry_run" {
  description = "Manter true até as tags protected-current/previous serem verificadas no bootstrap."
  type        = bool
  default     = true
}

locals {
  name_prefix = "farejo-scraper"
  secret_ids = {
    supabase_url                = "farejo-scraper-supabase-url"
    supabase_service_role_key   = "farejo-scraper-supabase-service-role-key"
    catalog_invalidation_url    = "farejo-scraper-catalog-invalidation-url"
    catalog_invalidation_secret = "farejo-scraper-catalog-invalidation-secret"
  }
  required_apis = toset([
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudscheduler.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
  ])
}

resource "terraform_data" "configuration_guard" {
  input = {
    enable_job       = var.enable_job
    enable_scheduler = var.enable_scheduler
  }

  lifecycle {
    precondition {
      condition     = !var.enable_scheduler || var.enable_job
      error_message = "Habilite o Cloud Run Job antes de habilitar o Cloud Scheduler."
    }
  }
}

resource "google_project_service" "required" {
  for_each           = local.required_apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "scraper" {
  project       = var.project_id
  location      = var.region
  repository_id = local.name_prefix
  description   = "Imagens imutáveis do scraper Farejo executado no Cloud Run."
  format        = "DOCKER"

  docker_config {
    immutable_tags = false
  }

  cleanup_policy_dry_run = var.artifact_cleanup_dry_run
  cleanup_policies {
    id     = "keep-protected"
    action = "KEEP"
    condition {
      tag_state    = "TAGGED"
      tag_prefixes = ["protected-"]
    }
  }
  cleanup_policies {
    id     = "keep-recent-five"
    action = "KEEP"
    most_recent_versions {
      package_name_prefixes = ["scraper"]
      keep_count            = 5
    }
  }
  cleanup_policies {
    id     = "delete-old-candidates"
    action = "DELETE"
    condition {
      tag_state  = "ANY"
      older_than = "604800s"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "runner" {
  project      = var.project_id
  account_id   = "farejo-scraper-runner"
  display_name = "Farejo scraper Cloud Run runtime"
}

resource "google_service_account" "scheduler" {
  project      = var.project_id
  account_id   = "farejo-scraper-scheduler"
  display_name = "Farejo scraper Cloud Scheduler invoker"
}

resource "google_secret_manager_secret" "scraper" {
  for_each  = local.secret_ids
  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "runner_access" {
  for_each  = google_secret_manager_secret.scraper
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runner.email}"
}



resource "google_cloud_run_v2_job_iam_member" "scheduler_invoker" {
  count    = var.enable_job ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = local.name_prefix
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}



resource "google_billing_budget" "pilot" {
  billing_account = var.billing_account_id
  display_name    = "Farejo Cloud Run pilot - BRL ${var.monthly_budget_brl} monthly alert"

  budget_filter {
    projects               = ["projects/${data.google_project.current.number}"]
    calendar_period        = "MONTH"
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "BRL"
      units         = tostring(floor(var.monthly_budget_brl))
      nanos         = floor((var.monthly_budget_brl - floor(var.monthly_budget_brl)) * 1000000000)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }

  threshold_rules {
    threshold_percent = 0.9
  }

  threshold_rules {
    threshold_percent = 1.0
  }

  all_updates_rule {
    disable_default_iam_recipients   = false
    enable_project_level_recipients  = var.budget_enable_project_recipients
    monitoring_notification_channels = var.budget_notification_channels
  }

  depends_on = [google_project_service.required]
}
