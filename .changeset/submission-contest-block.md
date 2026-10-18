---
'qhhoj-backend': minor
---

`GET /submissions/:id` carries `contest`: the key and name of the contest it was submitted in, and the points it scored there (`ContestSubmission.points`). It is null outside a contest and for a viewer who may not see that contest.
