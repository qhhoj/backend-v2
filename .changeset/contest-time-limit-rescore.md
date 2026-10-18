---
'qhhoj-backend': patch
---

Setting or clearing a contest's `timeLimit` queues a contest rescore. When a limit is set, a live row's start moves from the contest start to its join time, so its cell times and cumulative time went stale. Changing one limit to another does not rescore.
