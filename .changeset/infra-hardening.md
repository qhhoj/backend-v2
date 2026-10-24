---
'qhhoj-backend': patch
---

Deploy and host hardening: deploys only from main to commits on main, deploy user restricted to its dispatcher, problem-data owner-only with per-user ACLs, HSTS one year, current CSP hash, ACME gate exemption on port 80 only, scratch mongod on unix sockets only, CI without dependency install scripts.
