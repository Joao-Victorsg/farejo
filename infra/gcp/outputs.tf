output "artifact_registry_repository" {
  description = "Repositório que recebe as imagens do scraper."
  value       = google_artifact_registry_repository.scraper.name
}

output "image_uri_prefix" {
  description = "Prefixo para criar uma imagem identificada pelo commit."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.scraper.repository_id}/scraper"
}

output "runtime_service_account" {
  description = "Identidade de execução do Cloud Run Job."
  value       = google_service_account.runner.email
}

output "scheduler_service_account" {
  description = "Identidade autorizada a iniciar o Cloud Run Job."
  value       = google_service_account.scheduler.email
}

output "cloud_run_job_name" {
  description = "Nome do Cloud Run Job, quando habilitado."
  value       = var.enable_job ? local.name_prefix : null
}

output "cloud_scheduler_job_name" {
  description = "Nome do Cloud Scheduler, quando habilitado."
  value       = var.enable_scheduler ? "farejo-scrape-0900-brt" : null
}
