---
'qhhoj-backend': patch
---

Polygon import and sync take only full packages (with the Linux variant); a standard-only package is refused with its id, revision and state instead of failing the download with HTTP 500.
