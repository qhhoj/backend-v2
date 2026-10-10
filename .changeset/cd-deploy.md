---
'qhhoj-backend': minor
---

Continuous deployment: a release tag builds the image, pushes it to GHCR and deploys it through `qhhoj-deploy` after CI passes; the `deploy` workflow also rebuilds and deploys any ref by hand. A running contest defers the restart unless forced.
