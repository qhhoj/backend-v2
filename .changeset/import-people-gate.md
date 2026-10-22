---
'qhhoj-backend': patch
---

A zip or Polygon-link import that changes a problem's `authors` or `curators` needs `judge.edit_all_problem`, as the editor does: an update may only repeat the stored lists, a create may name only the requester as curator and no author. Otherwise 403 `forbidden`, before the package is stored.
