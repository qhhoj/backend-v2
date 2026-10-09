---
'qhhoj-backend': minor
---

`/api/internal/integration-clients` (session-only, no impersonation, `judge.manage_integration`): create a client (`name`, `scopes`, `allowedCidrs`, `actsAs` username, optional future `expiresAt`) and see its `qhi_` key once, list clients without keys, revoke idempotently. The acting user must be active and hold `judge.add_contest` and `judge.create_private_contest`. Creation and revocation log one structured line each, never the key.
