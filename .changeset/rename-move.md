---
'qhhoj-backend': patch
---

A problem code rename moves the test data directory before it saves the code: a failed move saves nothing and a failed save moves the directory back, so the problem stays judgeable.
