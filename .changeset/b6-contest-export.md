---
'qhhoj-backend': minor
---

Contest submissions export: `GET|POST /contests/:key/export` (status; queue the `contest-export` job, once a day, after the end) and `GET /contests/:key/export/download` (zip with `submissions.csv` and the sources). Editors only; formula-safe CSV cells.
