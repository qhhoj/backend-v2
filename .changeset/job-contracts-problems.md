---
'qhhoj-backend': patch
---

Problem jobs (statement PDF, Polygon import and auto-sync, compile check, solvers recompute, purge, package) run as typed job contracts. The daily package cache sweep now runs at 04:15 in the site time zone (`site.timeZone`) instead of the server's.
