---
'qhhoj-backend': minor
---

Add `PUT /submissions/{id}/score`: a manual verdict and score (`judge.change_submission` plus edit rights on the problem) on a finished submission, stored on the problem's scale so contest results (bar ioi16 batches), solved state and rescores agree; optional `lock`, logged as a revision. The submission viewer gains `canOverrideScore`.
