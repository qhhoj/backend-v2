---
'qhhoj-backend': patch
---

Notifications: the announcement fan-out is idempotent per announcement (a retry or reordered run never double-counts, reopens a read row or puts older text on top), the nightly trim covers every user over the cap, and the default SSE caps leave 500 slots for submission and ticket streams (contest 1500, user 2000).
