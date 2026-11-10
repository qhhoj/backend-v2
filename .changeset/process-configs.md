---
'qhhoj-backend': patch
---

Each process reads only the env variables it uses: the bridge no longer needs `SITE_URL`, `TOKEN_SECRET`, `SESSION_SECRET`, `PROBLEM_DATA_ROOT` or `PDF_CACHE_ROOT`, and the worker no longer needs `TOKEN_SECRET`. No variable was added, removed or renamed. `LISTEN_HOST` unset now means loopback whatever `NODE_ENV` is (production already listened on loopback).
