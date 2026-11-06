---
'qhhoj-backend': patch
---

One-off data fixes run once through `worker migrate`, which the deploy runs after the index step and records in a `migrations` collection; the worker and api no longer run them at boot. `quota.enforce` now waits for the size backfill's `migrations` row, so a Redis flush no longer turns it off. Removed: the session key migration and `SESSION_KEY_MIGRATION`, the unused legacy crypto helpers, and the warning for environment variables that became settings. The worker refuses to start while a migration is pending (`npm run migrate` in dev), and `worker <step>` exits 64 for an unknown step. The deploy runs `migrate` only on images that list it in the `org.qhhoj.deploy-steps` label, and runs both one-shot steps confined and under a 30-minute timeout. Re-run `install-host.sh` before deploying this release, or its deploy fails and rolls back.
