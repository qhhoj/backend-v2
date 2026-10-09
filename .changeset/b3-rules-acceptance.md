---
'qhhoj-backend': minor
---

Contest rules acceptance: `POST /contests/:key/register` and `/join` take `acceptRules`; a contest with rules answers 400 `rules_not_accepted` unless it is true when the call creates a participation (registration, first live join, every virtual join). The accepted time and revision are stored and returned as `rulesAcceptedAt` and `rulesAcceptedRevision` on participation rows.
