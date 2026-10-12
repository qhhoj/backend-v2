---
'qhhoj-backend': minor
---

Problem files: administrators of an organization-private problem's organizations may upload and remove its PDF statement and material without `judge.upload_file_statement` / `judge.upload_problem_material`; the files count against the organization's storage. New `DELETE /problems/{code}/statement` and `/material`, editor flags `canUploadPdfStatement` / `canUploadMaterial`, and `materialExtensions` in the problem meta.
