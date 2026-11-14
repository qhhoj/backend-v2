---
'qhhoj-backend': patch
---

Activating an account reports `passwordVoided` even when the password-reset mail fails, so clients can tell the signup password no longer works.
