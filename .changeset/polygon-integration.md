---
'qhhoj-backend': minor
---

Polygon integration: admin settings `polygon.apiKey`, `polygon.apiSecret` (encrypted), `polygon.accountName`; `GET /polygon/status`, `POST /polygon/test`, `GET /polygon/problems`, `POST /polygon/problems/{polygonId}/import`; `GET|PATCH|DELETE /problems/{code}/polygon` and `POST /problems/{code}/polygon/sync`; a 10-minute auto-sync worker job. Import job status gains `step` (queued, downloading, statements, tests, done, failed) and `progress`.
