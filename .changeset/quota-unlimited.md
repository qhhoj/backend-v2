---
'qhhoj-backend': minor
---

Unlimited quota promotion: organizations imported from the old site get `quotaUnlimited`, which lifts the credit and storage limits (usage is still metered); usage responses carry `unlimited` and staff can end it through `PATCH /organizations/:slug/quota`.
