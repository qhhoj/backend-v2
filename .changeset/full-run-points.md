---
'qhhoj-backend': patch
---

Problem data: the save refuses a case set whose only points are on plain pretest cases, since a full run grades those at 0 and could never score. Pretest batches keep counting.
