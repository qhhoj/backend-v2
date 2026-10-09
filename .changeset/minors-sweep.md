---
'qhhoj-backend': patch
---

Pre-release minors: a request body over a route's limit answers 413 with error code `payload_too_large` and `issues[]` (was `http_error`); a failed final-judge job removal still schedules the new job; a failing effects repair is logged once per hour instead of on every sweep. RUNBOOK deploy notes list the stream cap changes.
