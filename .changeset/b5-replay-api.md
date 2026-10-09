---
'qhhoj-backend': minor
---

Contest replay API: `GET /contests/:key/replay` serves the built replay in chunks (gated like the board; 202 `building` while it is built), `POST /contests/:key/replay/rebuild` lets editors request a build (3/hour, refunded when the queue refuses it), and `GET /contests/:key/actions` reports `replay`.
