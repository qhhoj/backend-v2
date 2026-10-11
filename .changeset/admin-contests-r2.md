---
'qhhoj-backend': minor
---

Contests admin: `GET /contests` gains `visible`, `mine`, `startFrom`, `startBefore` and `sort` (`newest`, `oldest`, `name`, `users`), and an `editor` block per row (`isVisible`, `lockedAfter`, FSO `pendingCount`) for contests the viewer may edit; `POST /contests/bulk/visibility` and `POST /contests/bulk/tag` apply the PATCH per key with per-key `done`/`unchanged`/`failed`; `POST /contests/{key}/participations/disqualify` disqualifies or reinstates up to 100 rows with one rescore; the participation list takes `search` (username contains, editors only); contests store `ogImage` (link previews) and `logoOverrideImage`; editors may run final judging once an FSO contest has started; contest tags carry `contestCount` among the contests the viewer may see.
