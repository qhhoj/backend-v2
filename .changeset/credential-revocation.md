---
'qhhoj-backend': patch
---

Tighten credential revocation: accounts carry a credential epoch, raised in the same write as every revocation, and sessions, reset links and activation keys issued before it are refused.
