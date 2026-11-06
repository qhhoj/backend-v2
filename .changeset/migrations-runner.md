---
'qhhoj-backend': patch
---

One-off data fixes run once through `worker migrate`, which the deploy runs after the index step and records in a `migrations` collection; the worker and api no longer run them at boot. `quota.enforce` now waits for the size backfill's `migrations` row, so a Redis flush no longer turns it off. Removed: the session key migration and `SESSION_KEY_MIGRATION`, the unused legacy crypto helpers, and the warning for environment variables that became settings. Re-run `install-host.sh` so deploys run the migrate step.
