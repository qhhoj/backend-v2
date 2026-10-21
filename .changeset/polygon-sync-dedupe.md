---
'qhhoj-backend': patch
---

Polygon sync: one job per problem and package for manual syncs too (a second sync joins the one in flight, and a sync of a package another sync already applied ends as ok); every sync uses the link's testcase limit; `GET /problems/{code}/polygon` returns the running job id, which the problem's editors may poll; a package download fails after a minute without data instead of a fixed 10 minutes, and a broken-off body is `polygon_unavailable`.
