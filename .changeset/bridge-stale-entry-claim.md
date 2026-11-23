---
'qhhoj-backend': patch
---

fix(bridge): a successful claim voids runs of older generations still held or being resumed, so a stale queued entry claimed during a grace-expiry requeue no longer gives the run two holders
