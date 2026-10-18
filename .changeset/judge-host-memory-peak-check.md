---
'qhhoj-backend': patch
---

Deploy: the judge host check (`deploy/judge/check-host.sh`) now fails when isolate's cgroup has no `memory.peak` (kernel before 5.19), resynced from judge-v2 #32.
