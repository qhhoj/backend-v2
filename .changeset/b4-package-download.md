---
'qhhoj-backend': minor
---

Problem package download for editors: `POST /problems/:code/package` queues a build, `GET` serves the zip. PDF and material uploads and code renames drop the cached packages; cache hits refresh the file time so eviction is least-recently-used, and a zip deleted during a sweep or eviction is no longer an error.
