module "cicd" {
  source       = "./modules/cicd"
  project_id   = var.project_id
  region       = var.region
  runner_email = google_service_account.runner.email
  depends_on   = [google_project_service.required, google_artifact_registry_repository.scraper]
}

output "github_variables" { value = module.cicd.variables }
