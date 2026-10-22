---
'qhhoj-backend': patch
---

`PATCH /api/internal/admin/users/{username}/access` also accepts a superuser's API token; its audit record carries the comment `via API token`. Any other API token, and every other session-only route, still answers 403 `This endpoint requires a browser session`.
