---
'qhhoj-backend': patch
---

Meter correct passwords atomically (one per-account budget for login and confirmation, plus per address on login), cap concurrent PBKDF2 hashes at 2 and refuse a check that waited 20 s for a slot with 429; contests admit only problems the editor edits, site-public ones, or members-only problems of organizations the contest is private to and the editor administers; suggesters edit only their own suggestions; unban restores the pre-ban active flag and ban/unban are audited; sessions have an absolute lifetime (`auth.sessionMaxDays`) and expired members leave the user's session set.
