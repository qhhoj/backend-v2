---
'qhhoj-backend': minor
---

Problem foundation for soft delete: new `judge.delete_problem` permission (granted to holders of `judge.edit_all_problem`), `problem.deleteGraceDays` setting (default 30), and the codes `deleted`, `meta` and `imports` are now refused for new, renamed, cloned and imported problems.
