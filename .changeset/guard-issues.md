---
'qhhoj-backend': patch
---

Every 4xx refusal carries `error.issues[]`, including those from the auth guard, the permission check, the rate limiter and framework exceptions: one request-level issue (`field` empty) coded `unauthenticated` for 401 and after the error code otherwise (`forbidden`, `rate_limited`, ...). `Retry-After` and extra members are unchanged.
