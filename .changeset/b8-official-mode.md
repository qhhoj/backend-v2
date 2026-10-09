---
'qhhoj-backend': minor
---

Official-contest mode: while a contest has it on, changing the badge or organization order in `PATCH /profile` and joining, leaving or requesting an organization answer 403 `locked_in_official_contest` (superusers exempt); `GET /site` gains `officialMode` and `officialModeEndsAt`, and the mode switches off by itself at the end time.
