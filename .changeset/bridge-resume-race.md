---
'qhhoj-backend': patch
---

Bridge: a judge resuming its runs after a bridge restart holds them while their rows are read, so a resync tick can no longer requeue a run to another judge while its judge is told to continue it (#360).
