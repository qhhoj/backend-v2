---
'qhhoj-backend': minor
---

Organization problem creators without `judge.import_polygon_package` may use the zip and Polygon imports to create problems for their organizations (`organization` required; no update, no auto-sync). A failed organization import gives its credits back once (worker); a package downloaded from Polygon is checked against the organization's storage. Imported organization problems are announced like ones created on the site. `DiscordWebhooksService` moves to `@libs/community`, the shared quota primitives to `QuotaLedger` in `@libs/problems`.
