---
'qhhoj-backend': patch
---

Sessions are keyed and signed with the new required `SESSION_SECRET` (at least 32 bytes); existing sessions are rebound on the api's first boot with `SESSION_KEY_MIGRATION=1` (staff, superusers and permission holders sign in once). Per-user session indexes now expire and drop dead members.
