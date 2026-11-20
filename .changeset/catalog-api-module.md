---
'qhhoj-backend': patch
---

`CatalogApiModule` owns the cached catalog queriers; the judges, home and users modules import it and `SharedApiModule` instead of the problems module.
