---
'qhhoj-backend': minor
---

New optional env `EXTRA_ORIGINS`: exact https origins besides `SITE_URL`'s that may send cookie requests and WebAuthn assertions, so a staging frontend (staging.qhhoj.com) can use the production api. Empty by default. `qhhoj-deploy` gains `frontend-staging`, and nginx a staging site that is never indexed. The session cookie becomes `__Host-qhhoj_session` (with `COOKIE_SECURE`); an existing `qhhoj_session` is accepted once and reissued, so nobody is logged out. `EXTRA_ORIGINS` refuses an origin with a port. `qhhoj-deploy-serve --staging-only` restricts the staging deploy key to `frontend-staging`.
