---
'qhhoj-backend': minor
---

Short links: `POST/GET/DELETE /api/internal/short-links` (signed-in users get one automatic link per site path; `judge.manage_short_link` holders choose the code and expiry, list all links, delete, and have no daily quota) and the public `GET /s/:code` 302 redirect with hit counting.
