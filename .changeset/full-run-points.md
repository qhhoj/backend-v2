---
'qhhoj-backend': patch
---

Problem data: a PUT or upload whose points are all on plain pretest cases is refused with a 400 before anything is written, since a full run grades those at 0 and could never score. The stored data and init.yml stay as they were. Pretest batches keep counting.
