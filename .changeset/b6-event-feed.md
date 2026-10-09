---
'qhhoj-backend': minor
---

ICPC event feed snapshot: `GET /api/internal/contests/:key/feed` answers NDJSON to HTTP Basic with the contest's feed key. Live, non-disqualified teams only; unlisted organizations are never named. By default the feed is cut at the freeze until the key is released (a release counts only for the freeze it was made in, and `thawed` is never reported while the feed is cut). Contests over 100 000 submissions answer 409 `feed_too_large`. The failure lock uses `request.ip`, so set `TRUST_PROXY` behind nginx.
