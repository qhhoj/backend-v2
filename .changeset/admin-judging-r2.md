---
'qhhoj-backend': minor
---

Judges: `POST /judges/{name}/rename` (offline judges with nothing in flight; queued and pending pins follow), `blockReason` on the judge PATCH and response (cleared on unblock), and `ipHistory` (last 20 addresses with first/last seen and connection count, written by the bridge at each Hello). Languages: `isActive` (inactive languages are hidden from a problem's `allowedLanguages`, left out of new problems' defaults and refused at submit with 400 `language_inactive`) and `order` (lists sort by order, then name), plus `GET /admin/languages/usage` (problems allowing each language, submissions over the last 30 days).
