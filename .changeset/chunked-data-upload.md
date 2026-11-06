---
'qhhoj-backend': minor
---

Test-data archives of up to 2 GiB can be uploaded in 48 MiB chunks (`/problems/{code}/data/uploads`) and resumed after a dropped connection; complete stores them exactly like the single archive upload. nginx: a 64m chunk location, the archive and import location lowered to 95m (Cloudflare's 100 MB).
