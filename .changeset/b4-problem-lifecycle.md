---
'qhhoj-backend': minor
---

Problem delete and restore: `DELETE /problems/:code` (confirm by code; `judge.delete_problem` plus edit rights; 409 `problem_in_contest`), `POST /problems/:code/restore`, `GET /problems/deleted` (with `daysLeft`) and superuser `POST /problems/:code/purge-now`. Delete and restore recompute the solver counters of the problem's submitters through a `problem-solvers-recompute` job.
