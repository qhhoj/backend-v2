---
'qhhoj-backend': minor
---

Polygon: `judge.import_polygon_package` is removed and its holders get the new `judge.sync_polygon_problem` (migrated on worker boot). Imports need only the rights of the change (create or test data write access); sync, auto-sync and link changes need the new permission plus test data write access; the link state and its history need only the write access. Syncs of organization-private problems are checked against the organization's storage; turning auto-sync on makes the switcher the user it runs as.
