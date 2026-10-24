---
"qhhoj-backend": patch
---

bridge: a Judging a judge cannot run for a transient reason (`RETRY` DATA_UNAVAILABLE, RUNTIME_MISSING, SANDBOX_FAILURE) is requeued with a backoff instead of spending the 3-RETRY cap, waits while its problem's data is being written, shows `waitingReason` on the submission detail, and ends IE only after 30 minutes; per-case jury time (judge proto minor 4) is stored and charged; a Final whose store fails is retried in the session and, if it never lands, its slot is freed and the row requeued unspent; case points are clamped to the case total and a failed case never gives full marks; judge-reported error text is sanitized before logging; a resync tick no longer voids a run whose RETRY it read mid-store (that left a judge slot taken until reconnect).
