---
'qhhoj-backend': minor
---

`GET /contests/:key/actions` reports the submissions export state (`export`). The feed stream retries a failed shared build on the next tick and ends only after three failures in a row; the shared build is rebuilt at once when an editor changes the freeze or end time.
