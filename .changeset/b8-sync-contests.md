---
'qhhoj-backend': minor
---

Sync API v1 for integration clients: `PUT /api/sync/v1/contests/:key` (`?dryRun=true` validates only) creates or replaces a contest the client owns and answers `created`, `updated` or `unchanged`; `GET /api/sync/v1/contests/:key` reads it. Created contests are hidden, private, authored by the client's acting user and owned through `managedBy`; the body has no visibility, privacy, organization, author or access-code field. Another owner's key is 403 on `PUT` and 404 (same body as a missing key) on reads. A published or started contest refuses changes (`409 contest_frozen`). The acting user is re-checked on every request; 60 requests a minute per client. `ContestEditingService` gains `applyFields` (the follow-ups of an edit, including the final-submission guard) and a public `insert`.
