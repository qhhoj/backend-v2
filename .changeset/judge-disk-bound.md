---
'qhhoj-backend': patch
---

The local judge-v2 stack starts its judge with `allow_unbounded_disk`, which judge-v2 now needs on a box root without a disk quota.
