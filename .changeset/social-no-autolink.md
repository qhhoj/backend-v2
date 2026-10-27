---
'qhhoj-backend': patch
---

A social sign-in whose provider account is not linked no longer attaches to an existing account by e-mail: it is refused with `social_email_in_use` and changes nothing.
