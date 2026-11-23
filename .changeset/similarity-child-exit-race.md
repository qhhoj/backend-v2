---
'qhhoj-backend': patch
---

fix(similarity): the engine child watches the worker channel from its first line, so it exits when the worker dies before the config line arrives
