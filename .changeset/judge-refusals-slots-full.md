---
'qhhoj-backend': patch
---

Problem data: saving `nobigmath` or cases graded with different checkers is refused with a field error (judge-v2 answered every submission UNSUPPORTED). Bridge: SLOTS_FULL on an Assign sends that run back to QU without spending its requeue, kept off that judge until the next resync tick, instead of ending the session; a late SLOTS_FULL for a released run frees its slot.
