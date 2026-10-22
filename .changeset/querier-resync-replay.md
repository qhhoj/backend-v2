---
'qhhoj-backend': patch
---

In-memory queriers (groups, settings, catalogs) re-apply the change-stream events handled while a resync was loading, so a permission revoke, setting change or catalog delete made during the load is no longer undone by the swap until the next resync.
