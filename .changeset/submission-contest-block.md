---
'qhhoj-backend': minor
---

`GET /submissions/:id` carries `contest`: the key and name of the contest it was submitted in, the points it scores there (worked out as the scoreboard stores them, so a read right after judging is already exact), and, for the submitter's own submission made within its run, the run minute as the scoreboard counts it. It is null outside a contest and for a viewer who may not see that contest.
