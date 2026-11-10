---
"qhhoj-backend": patch
---

A job whose worker was killed twice mid-run is queued again while it has attempts left, instead of staying failed; queues start consuming without waiting for another queue's index build; a points recompute flag set after its 1 s bound is cleared when its add fails.
