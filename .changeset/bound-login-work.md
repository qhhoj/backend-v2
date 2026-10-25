---
'qhhoj-backend': patch
---

Bound per-address login work: password checks are served fairly across client networks and, inside one, across client addresses; one address holds at most 64 at once (running or queued), so a classroom behind one NAT signs in at once; per-address rate limits count an IPv6 client per /64. nginx mirrors the login bound of 64 (`deploy/nginx/login-limit.conf`).
