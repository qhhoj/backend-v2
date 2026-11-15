---
'qhhoj-backend': minor
---

`GET /contests/current` now returns `standing`: the caller's own rank, score and penalty on the board a non-editor sees (frozen values during a freeze), read from the cached ranking.
