---
'qhhoj-backend': minor
---

Integration-client principal: `@ServiceOnly()` routes accept only `Authorization: Bearer qhi_...` keys (sha256-stored, constant-time re-checked, CIDR- and scope-bound, refused when revoked or past `expiresAt`; failed keys throttled per address). User credentials on those routes are 403; a `qhi_` key on any other route is 401. The API warns at boot when active clients exist and `TRUST_PROXY` is off.
