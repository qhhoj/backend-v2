---
'qhhoj-backend': minor
---

Submission list rows (`GET /submissions`, the contest, organization and best lists) carry `contest` ({key, name, points, minute}) like the submission detail, under the same `canSee` rule; null outside a contest and for a contest the viewer may not see.
