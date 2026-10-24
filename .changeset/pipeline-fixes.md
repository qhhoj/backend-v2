---
'qhhoj-backend': patch
---

bridge judging fixes:

- `RETRY` DATA_UNAVAILABLE, RUNTIME_MISSING, SANDBOX_FAILURE: requeued with a jittered backoff outside the 3-RETRY cap, held while the problem's data is written, shown as `waitingReason`, IE after 30 minutes; another requeue starts the wait over.
- Per-case jury time (judge proto minor 4) is stored.
- A Final whose store fails is retried in the session; if it never lands the slot is freed and the row requeued (free twice, then it spends a RETRY).
- Case points are clamped to the case total, and the clamp is logged.
- Judge-reported error text is sanitized before logging.
- A run whose Final is being stored is not voided or timed out, so it no longer leaks a judge slot.
