---
'qhhoj-backend': patch
---

Sync API hardening: every sync route (reads, participants, delete included) re-checks the acting user and refuses a deactivated user, a superuser, or one missing a required codename (403); a superuser cannot be named as an acting user at creation; a `@ServiceOnly()` route without `@RequireScope` refuses every key; delete re-states "owned, hidden, not started" in the delete itself and is refused when any submission is stamped with the contest; an unknown and a hidden problem code get the same error. Failed integration keys lock an address out for 10 minutes after 20 tries, valid keys included: behind nginx set `TRUST_PROXY`.
