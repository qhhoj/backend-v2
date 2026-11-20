---
'qhhoj-backend': patch
---

`GET /organizations/:slug/usage` returns `costs { problem, contest, dataPer10MiB }`, the credit prices from the `quota.cost.*` settings.

Submissions: a problem's editors see every test case result of every submission to it, whatever `testcaseResultVisibility` is.
