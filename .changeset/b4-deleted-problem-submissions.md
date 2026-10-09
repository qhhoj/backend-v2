---
'qhhoj-backend': minor
---

Submissions of a deleted or purged problem keep rendering their problem name (`problem.isDeleted`) in lists and detail, for the submission's owner and `judge.view_all_submission` holders only, with no case detail. Rejudge and reject of such a submission answer 409 `problem_deleted`.
