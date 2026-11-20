---
'qhhoj-backend': patch
---

`GET /organizations/:slug/usage` returns `costs { problem, contest, dataPer10MiB }`, the credit prices from the `quota.cost.*` settings.

Submissions: a problem's editors who may read a submission's source see every test case result of it, whatever `testcaseResultVisibility` is.
