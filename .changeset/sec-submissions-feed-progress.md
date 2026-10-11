---
'qhhoj-backend': patch
---

Submissions: the public feed's delivery queue is bounded (drops and sends `resync` when backed up), and the detail's `currentTestcase` is null unless the viewer sees every case result.
