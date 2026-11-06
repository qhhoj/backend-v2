---
'qhhoj-backend': patch
---

Judging jobs (graded, problem rescore, effects sweep, similarity) are declared once as job contracts that the api, bridge and worker share; queue names, job ids, schedules and options are unchanged, so jobs queued before the deploy still run. Every worker of these queues now logs worker errors.
