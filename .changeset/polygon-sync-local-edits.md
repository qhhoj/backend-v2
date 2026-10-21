---
'qhhoj-backend': patch
---

A Polygon sync keeps the time and memory limits, partial scoring, checker (type, arguments, source) and grader settings edited on QHHOJ since the last import instead of overwriting them; `POST /problems/{code}/polygon/sync` takes `{overwriteLocalEdits: true}` to restore the package's values (409 `polygon_sync_queued` while a sync keeping them is queued), and the job's `result.localEdits` lists the kept and updated settings. A sync also keeps `unicode`, `nobigmath`, `outputPrefix` and `outputLimit`. `imported_needs_attention` sends `{step}`, a missing problem group or type fails with `catalog_missing`, the link check hides Polygon's build comment until the link token is checked, and a sync rerun after a worker restart fails visibly instead of reporting ok.
