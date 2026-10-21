---
'qhhoj-backend': patch
---

Polygon import jobs: a failed job, link and sync run carry `errorCode` and `errorParams` (`PolygonImportErrorCode`) besides the English message, and a job says whether it is `retryable`; a waiting job shows its `queuePosition`; a completed job's `result.summary` lists the checker mapping, tests, cases, batches and clamped limits, and `result.attention` (code `imported_needs_attention`) a problem imported whose finishing steps failed; `GET /problems/imports?mine=1` lists the caller's jobs; an outage or a missing judge is retried once after 2 min; automatic syncs queue behind manual imports; an import or sync whose statement languages or testcase count would fail is refused before queueing.
