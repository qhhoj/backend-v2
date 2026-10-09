---
'qhhoj-backend': minor
---

Worker: a nightly (03:00) organization usage audit compares each credit counter with the ledger sum for the current and previous month and logs one `organization.usage.drift` warning per mismatch; it never changes data.
