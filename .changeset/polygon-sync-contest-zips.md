---
'qhhoj-backend': patch
---

An automatic Polygon sync that reaches a problem in a running contest waits until the contest ends instead of rewriting it; a package header named like one of the problem's own data files (a kept local checker) is left out; contest export and data zips are swept after 7 days (crashed temp files after a day) and removed with their contest, and each kind is built at most 3 times per contest per day.
