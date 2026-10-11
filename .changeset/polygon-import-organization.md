---
'qhhoj-backend': minor
---

Polygon import (zip and link) takes an optional `organization` slug on create: the problem is private to that organization, needs its creation rights instead of `judge.add_problem`, the code prefix, and is charged to its quota (credits when queued, storage of the package).
