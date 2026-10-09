---
'qhhoj-backend': patch
---

Submissions: every finished row carries `effectsDueAt` until its graded job applied the effects; the worker's effects sweep re-applies rows still due after 2 minutes (user, problem and contest results), so a bridge crash between the verdict write and the job no longer leaves a scoreboard stale. A submit with `judgeId` stores the pin (`pinnedJudge`) and keeps it across requeues and bridge restarts; a rejudge clears it.
