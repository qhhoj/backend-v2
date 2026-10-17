---
'qhhoj-backend': minor
---

The reason of an organization join request is optional: `POST /organizations/:slug/requests` takes a missing, blank or null `reason` as an empty one (still at most 4096 characters).
