---
'qhhoj-backend': minor
---

Contest event feed stream `GET /api/internal/events/contests/:key/feed` (HTTP Basic feed key, NDJSON): the snapshot, then new events; at most two streams per key, counted in the SSE caps, closed when the key is revoked or its owner loses the editor right; a cut feed never sends frozen events.
