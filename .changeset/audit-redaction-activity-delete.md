---
'qhhoj-backend': patch
---

The audit feed hides the notes of user, problem and contest records, and the rows of superuser-only settings, from viewers who lack the matching permission; deleting user activity needs a browser session, refuses oneself and superusers (unless a superuser) and is recorded as a revision.
