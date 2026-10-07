removed {
  from = google_project_iam_member.legacy_compute_editor
  lifecycle {
    destroy = true
  }
}
