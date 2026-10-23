---
'qhhoj-backend': minor
---

Organization judging-time meter (measure only, nothing is refused): the worker charges each finished grading attempt of an organization problem once, in `organizationJudgingCharges` (CPU ms of the stored cases, solution plus `juryTime`), to the problem's first listed organization in the site time-zone month. `GET /organizations/:slug/usage` adds `judging`, `topProblems` and `quota.judgingMs`; the staff overview adds `judgingUsed`/`judgingLimit` and sort `judging`; `PATCH /organizations/:slug/quota` accepts `quotaJudgingMs` (null = setting `quota.defaultJudgingMs`, 10 h). Credit fields are unchanged.
