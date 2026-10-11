---
'qhhoj-backend': minor
---

Polygon import by link: `POST /polygon/resolve` checks a pasted problem link (its `p…` token against the `url` in the newest package's problem.xml) and previews the problem; `POST /polygon/import` takes the link in the body. `GET /polygon/problems` and `POST /polygon/problems/{polygonId}/import` are removed, with the shared-list cache. New errors `polygon_link_invalid`, `polygon_link_refused`, `polygon_no_package`; `polygon_already_linked` names the QHHOJ problem (and `linkedProblemCode`) only to its editors.
