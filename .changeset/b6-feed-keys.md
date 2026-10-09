---
'qhhoj-backend': minor
---

Contest feed keys: `GET|POST|DELETE /contests/:key/feed-key` (status, mint shown once, revoke) and `POST /contests/:key/feed-key/release` (release the frozen results to the resolver; 409 `not_frozen` outside a freeze). Editors only, from their own session (no API token, no impersonation); five mints an hour per user and contest.
