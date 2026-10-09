---
'qhhoj-backend': minor
---

`POST /contests/:key/publish-problems` publishes an ended contest's problems the caller may publish and, with `editorials`, their editorials; `dryRun` reports without writing. A real run costs 5 per hour per user and a failed run is refunded. A skipped problem carries a reason (`no_permission`, `organization_private`, `not_found`, `deleted`). Before the end it answers 409 `contest_not_ended`. The contest actions status gains `publish` and `autoPublish`.
