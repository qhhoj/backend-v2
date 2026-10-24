---
'qhhoj-backend': patch
---

RUNBOOK and env example: v2 uses its own Redis instance (`redis-qhhoj.service`, port 6380, ACL user `qhhoj`, db 0) instead of the shared host Redis.
