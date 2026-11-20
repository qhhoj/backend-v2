---
'qhhoj-backend': patch
---

The judges module's submission queries (runs in flight, pins on rename) move to `JudgeRunsRepository`; `WAITING_STATUSES` names the queued and pending set.
