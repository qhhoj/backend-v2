---
'qhhoj-backend': patch
---

Backend fixes from the site review:

- Organizations: a direct join honours `slots` (409 `organization_full`); an approval decides the request before adding the member, so a concurrent rejection never leaves a member.
- Blog: `summary` and `ogImage` need `judge.edit_all_post` to be set or changed.
- Contests: editors and testers joining an ended contest spectate instead of becoming virtual contestants.
- Auth: the session offers WebAuthn only when the user has a stored key (a legacy flag alone no longer locks the user out); staff with `judge.ban_user` can `POST /users/:username/reset-two-factor` (audit-logged, signs the user out); the password-reset and activation-resend email budgets ignore surrounding spaces; password reset and activation resend answer 503 `mail_unavailable` while SMTP is not configured.
- Judging: a run still held by a judge past a deadline (`runMarginMs` + time limit x `runCaseBudget`) is aborted and requeued once, then IE; a queued submission pinned to a judge that has been absent for `pinFallbackMs` falls back to any judge.
