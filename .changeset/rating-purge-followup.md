---
'qhhoj-backend': patch
---

A rating run also purges the cached boards of contests whose ratings it deletes (a contest that stopped being rated), and a failed purge no longer fails the job once the ratings are committed: it logs a warning and the boards expire after `scoreboardCacheTimeout`.
