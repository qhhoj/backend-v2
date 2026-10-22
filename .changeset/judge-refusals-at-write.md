---
'qhhoj-backend': patch
---

PUT and uploads refuse what judge-v2 refuses: a generator (upload or stored), an output limit above 64 MiB, and case files in dot folders; a delete is never refused, so a stored generator can always be removed; uploads can no longer take, and deletes no longer remove, a Polygon helper header.
