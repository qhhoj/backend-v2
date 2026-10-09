---
'qhhoj-backend': minor
---

Worker: a one-off `problem-databytes` backfill recomputes every problem's `dataBytes` from disk (compare-and-set, safe beside data writes) and sets the flag that lets `quota.enforce = enforce` take effect; a Polygon import records the data size under the data lock.
