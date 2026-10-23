---
'qhhoj-backend': minor
---

A Polygon import or sync refuses a package whose `run-count` is not 1 (Polygon run-twice) with the import error `polygon_run_count_unsupported` (`{runCount}`), instead of importing it as a one-run problem that would be misjudged.
