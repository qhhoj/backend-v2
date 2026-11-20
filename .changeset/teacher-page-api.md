---
'qhhoj-backend': patch
---

`GET /organizations/:slug/usage` returns `costs { problem, contest, dataPer10MiB }`, the credit prices from the `quota.cost.*` settings.
