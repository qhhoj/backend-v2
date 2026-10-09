---
'qhhoj-backend': patch
---

Bridge: an abort handled after a judge's stream died, but before the bridge handled the loss, now sticks: a resumed run is aborted right after the Welcome, or ends AB when the grace expires, instead of being graded or requeued.
