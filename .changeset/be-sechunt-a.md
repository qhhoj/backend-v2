---
'qhhoj-backend': patch
---

A TOTP flag without a stored key no longer blocks sign-in and can be enrolled again; a run resumed after a bridge restart gets the same deadline as one that never left (time limit and stored case count).
