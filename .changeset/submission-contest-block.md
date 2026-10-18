---
'qhhoj-backend': minor
---

`GET /submissions/:id` carries `contest`: the key and name of the contest it was submitted in, and the points it scores there (worked out as the scoreboard stores them, so a read right after judging is already exact). It is null outside a contest and for a viewer who may not see that contest.
