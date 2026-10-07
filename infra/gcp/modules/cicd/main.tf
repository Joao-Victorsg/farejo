variable "project_id" { type = string }
variable "region" { type = string }
variable "runner_email" { type = string }

locals {
  repository_id = "1297090348"
  owner_id      = "54454575"
  workflows = {
    publisher = { file = "gcp-prepare.yml", event = "workflow_run" }
    planner   = { file = "gcp-plan.yml", event = "workflow_run" }
    deployer  = { file = "gcp-deploy.yml", event = "workflow_dispatch" }
  }
  state_prefix = "scraper-prod"
}

resource "google_project_service" "federation" {
  for_each           = toset(["sts.googleapis.com", "iamcredentials.googleapis.com", "storage.googleapis.com"])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "state" {
  name                        = "${var.project_id}-tfstate"
  project                     = var.project_id
  location                    = "US-EAST1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  versioning { enabled = true }
  soft_delete_policy { retention_duration_seconds = 604800 }
  lifecycle_rule {
    action { type = "Delete" }
    condition {
      days_since_noncurrent_time = 30
      num_newer_versions         = 10
      with_state                 = "ARCHIVED"
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.federation]
}

resource "google_storage_bucket" "releases" {
  name                        = "${var.project_id}-releases"
  project                     = var.project_id
  location                    = "US-EAST1"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  soft_delete_policy { retention_duration_seconds = 604800 }
  lifecycle_rule {
    action { type = "Delete" }
    condition {
      age            = 7
      matches_prefix = ["plans/"]
    }
  }
  lifecycle_rule {
    action { type = "Delete" }
    condition {
      age            = 90
      matches_prefix = ["releases/"]
    }
  }
  lifecycle { prevent_destroy = true }
  depends_on = [google_project_service.federation]
}

# Separate pools prevent a token accepted for one stage from impersonating another.
resource "google_iam_workload_identity_pool" "github" {
  for_each                  = local.workflows
  project                   = var.project_id
  workload_identity_pool_id = "farejo-${each.key}"
  display_name              = "Farejo ${each.key}"
  depends_on                = [google_project_service.federation]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  for_each                           = local.workflows
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github[each.key].workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
  }
  attribute_condition = join(" && ", concat([
    "assertion.repository_id == '${local.repository_id}'",
    "assertion.repository_owner_id == '${local.owner_id}'",
    "assertion.ref == 'refs/heads/master'",
    "assertion.workflow_ref == 'Joao-Victorsg/farejo/.github/workflows/${each.value.file}@refs/heads/master'",
    "assertion.event_name == '${each.value.event}'",
    "assertion.runner_environment == 'github-hosted'",
  ], each.key == "deployer" ? ["assertion.actor_id == '${local.owner_id}'", "assertion.run_attempt == '1'"] : []))
  oidc { issuer_uri = "https://token.actions.githubusercontent.com" }
}

resource "google_service_account" "ci" {
  for_each     = local.workflows
  project      = var.project_id
  account_id   = "farejo-ci-${each.key}"
  display_name = "Farejo CI ${each.key}"
}

resource "google_service_account_iam_member" "federation" {
  for_each           = local.workflows
  service_account_id = google_service_account.ci[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github[each.key].name}/attribute.repository_id/${local.repository_id}"
}

resource "google_project_iam_custom_role" "artifact_publisher" {
  project = var.project_id
  role_id = "farejoArtifactPublisher"
  title   = "Farejo new image publication without tag replacement"
  permissions = [
    "artifactregistry.repositories.get", "artifactregistry.repositories.downloadArtifacts",
    "artifactregistry.repositories.uploadArtifacts", "artifactregistry.dockerimages.get",
    "artifactregistry.dockerimages.list", "artifactregistry.files.get", "artifactregistry.files.list",
    "artifactregistry.packages.get", "artifactregistry.packages.list",
    "artifactregistry.versions.get", "artifactregistry.versions.list",
    "artifactregistry.tags.create", "artifactregistry.tags.get", "artifactregistry.tags.list",
  ]
}

resource "google_artifact_registry_repository_iam_member" "publisher" {
  project    = var.project_id
  location   = var.region
  repository = "farejo-scraper"
  role       = google_project_iam_custom_role.artifact_publisher.name
  member     = "serviceAccount:${google_service_account.ci["publisher"].email}"
}

resource "google_project_iam_custom_role" "artifact_pins" {
  project = var.project_id
  role_id = "farejoArtifactPins"
  title   = "Farejo current and rollback image pins"
  permissions = [
    # Cloud Run validates that the deployer can download the selected image.
    "artifactregistry.repositories.get", "artifactregistry.repositories.downloadArtifacts",
    "artifactregistry.dockerimages.get",
    "artifactregistry.versions.get", "artifactregistry.tags.get", "artifactregistry.tags.list",
    "artifactregistry.tags.create",
  ]
}

resource "google_artifact_registry_repository_iam_member" "artifact_pins" {
  project    = var.project_id
  location   = var.region
  repository = "farejo-scraper"
  role       = google_project_iam_custom_role.artifact_pins.name
  member     = "serviceAccount:${google_service_account.ci["deployer"].email}"
}

resource "google_project_iam_custom_role" "runtime_reader" {
  project     = var.project_id
  role_id     = "farejoRuntimeReader"
  title       = "Farejo runtime planning"
  permissions = ["run.jobs.get", "run.jobs.getIamPolicy"]
}

resource "google_project_iam_custom_role" "runtime_writer" {
  project     = var.project_id
  role_id     = "farejoRuntimeWriter"
  title       = "Farejo runtime apply"
  permissions = ["run.jobs.get", "run.jobs.update", "run.jobs.getIamPolicy"]
}

resource "google_cloud_run_v2_job_iam_member" "runtime" {
  for_each = toset(["planner", "deployer"])
  project  = var.project_id
  role     = each.key == "planner" ? google_project_iam_custom_role.runtime_reader.name : google_project_iam_custom_role.runtime_writer.name
  member   = "serviceAccount:${google_service_account.ci[each.key].email}"
  location = var.region
  name     = "farejo-scraper"
}

resource "google_project_iam_custom_role" "scheduler_reader" {
  project     = var.project_id
  role_id     = "farejoSchedulerReader"
  title       = "Farejo Scheduler configuration read"
  permissions = ["cloudscheduler.jobs.get"]
}

# Scheduler resource attributes are not supported by IAM Conditions.
# Read metadata at project scope; never grant CI update/create/run permissions.
resource "google_project_iam_member" "scheduler" {
  for_each = toset(["planner", "deployer"])
  project  = var.project_id
  role     = google_project_iam_custom_role.scheduler_reader.name
  member   = "serviceAccount:${google_service_account.ci[each.key].email}"
}

resource "google_project_iam_custom_role" "project_metadata" {
  project     = var.project_id
  role_id     = "farejoProjectMetadata"
  title       = "Farejo provider metadata"
  permissions = ["resourcemanager.projects.get", "serviceusage.services.use"]
}

resource "google_project_iam_custom_role" "operations_reader" {
  project     = var.project_id
  role_id     = "farejoOperationsReader"
  title       = "Farejo Run operation polling"
  permissions = ["run.operations.get"]
}

resource "google_project_iam_member" "operations_reader" {
  for_each = toset(["planner", "deployer"])
  project  = var.project_id
  role     = google_project_iam_custom_role.operations_reader.name
  member   = "serviceAccount:${google_service_account.ci[each.key].email}"
}

resource "google_project_iam_member" "metadata" {
  for_each = local.workflows
  project  = var.project_id
  role     = google_project_iam_custom_role.project_metadata.name
  member   = "serviceAccount:${google_service_account.ci[each.key].email}"
}

resource "google_service_account_iam_member" "act_as" {
  for_each           = toset([var.runner_email])
  service_account_id = "projects/${var.project_id}/serviceAccounts/${each.value}"
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.ci["deployer"].email}"
}

resource "google_project_iam_custom_role" "bucket_metadata" {
  project     = var.project_id
  role_id     = "farejoBucketMetadata"
  title       = "Farejo backend metadata"
  permissions = ["storage.buckets.get", "storage.objects.list"]
}

resource "google_storage_bucket_iam_member" "state_metadata" {
  for_each = toset(["planner", "deployer"])
  bucket   = google_storage_bucket.state.name
  role     = google_project_iam_custom_role.bucket_metadata.name
  member   = "serviceAccount:${google_service_account.ci[each.key].email}"
}

resource "google_storage_bucket_iam_member" "state_reader" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.ci["planner"].email}"
  condition {
    title      = "operational_state_only"
    expression = "resource.name.startsWith('projects/_/buckets/${google_storage_bucket.state.name}/objects/${local.state_prefix}/')"
  }
}

resource "google_storage_bucket_iam_member" "lock" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ci["planner"].email}"
  condition {
    title      = "planner_lock_only"
    expression = "resource.name == 'projects/_/buckets/${google_storage_bucket.state.name}/objects/${local.state_prefix}/default.tflock'"
  }
}

resource "google_storage_bucket_iam_member" "state_writer" {
  bucket = google_storage_bucket.state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.ci["deployer"].email}"
  condition {
    title      = "operational_state_only"
    expression = "resource.name.startsWith('projects/_/buckets/${google_storage_bucket.state.name}/objects/${local.state_prefix}/')"
  }
}

resource "google_storage_bucket_iam_member" "release_creator" {
  bucket = google_storage_bucket.releases.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.ci["planner"].email}"
}

resource "google_storage_bucket_iam_member" "release_reader" {
  for_each = toset(["planner", "deployer"])
  bucket   = google_storage_bucket.releases.name
  role     = "roles/storage.objectViewer"
  member   = "serviceAccount:${google_service_account.ci[each.key].email}"
}

output "variables" {
  value = merge({
    GCP_PROJECT_ID      = var.project_id
    GCP_REGION          = var.region
    GCP_TF_STATE_BUCKET = google_storage_bucket.state.name
    GCP_RELEASE_BUCKET  = google_storage_bucket.releases.name
    }, { for stage, provider in google_iam_workload_identity_pool_provider.github : "GCP_${upper(stage)}_WIF_PROVIDER" => provider.name },
  { for stage, sa in google_service_account.ci : "GCP_${upper(stage)}_SERVICE_ACCOUNT" => sa.email })
}
