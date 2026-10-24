---
'qhhoj-backend': patch
---

Meter correct passwords on login and confirmation and cap concurrent PBKDF2 hashes; contests admit only problems the editor edits or site-public ones; suggesters edit only their own suggestions; unban restores the pre-ban active flag and ban/unban are audited; sessions have an absolute lifetime (`auth.sessionMaxDays`) and expired members leave the user's session set.
