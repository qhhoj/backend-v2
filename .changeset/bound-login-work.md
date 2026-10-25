---
'qhhoj-backend': patch
---

Bound per-address login work: password checks are served fairly across client addresses and one address holds at most 8 at once; per-address rate limits count an IPv6 client per /64. nginx mirrors the login bound (`deploy/nginx/login-limit.conf`).
