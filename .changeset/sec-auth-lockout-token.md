---
'qhhoj-backend': patch
---

Auth: login failures are counted per IP and per (account, IP), so failures from elsewhere no longer lock an account out. `POST /auth/token/regenerate` now requires `currentPassword`, and a password change or `logout-all` revokes the API token.
