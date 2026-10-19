---
'qhhoj-backend': patch
---

Organization storage quota: `QuotaLedger.assertStorage(organizationId, addedBytes)` reads the organization's stored bytes itself; the api and worker call sites no longer sum usage.
