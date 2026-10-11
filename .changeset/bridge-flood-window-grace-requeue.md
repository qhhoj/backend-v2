---
'qhhoj-backend': patch
---

Bridge: the judge message cap (1000/s) counts a sliding second, so a burst straddling a window edge is caught; a failed read when re-dispatching a requeued run after grace is logged instead of escaping as an unhandled rejection.
