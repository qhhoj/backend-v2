---
'qhhoj-backend': minor
---

Polygon follow-ups: sync history (`GET /polygon/syncs`, `GET /problems/{code}/polygon/syncs`; one `polygonSyncRuns` row per finished Polygon job with requester, package, result, failed step and error); import job status gains `failedStep`; `polygon.apiKey` is now a sealed secret (reads `{set}`, the existing plain row keeps working until the next save, old revision rows are redacted); package responses gain `createdAt`, the link gains `title` and `packageCreatedAt`.
