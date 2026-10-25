---
'qhhoj-backend': patch
---

Every `/api` response says how caches may treat it: one without its own `Cache-Control` gets `private, no-store`, and one with a `private, max-age` also sends `Vary: Cookie`. nginx adds the same default (`20-qhhoj-api-cache.conf`).
