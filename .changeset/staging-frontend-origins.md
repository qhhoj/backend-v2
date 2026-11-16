---
'qhhoj-backend': minor
---

New optional env `EXTRA_ORIGINS`: exact https origins besides `SITE_URL`'s that may send cookie requests and WebAuthn assertions, so a staging frontend (staging.qhhoj.com) can use the production api. Empty by default. `qhhoj-deploy` gains `frontend-staging`, and nginx a staging site that is never indexed.
