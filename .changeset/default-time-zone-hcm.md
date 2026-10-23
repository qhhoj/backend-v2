---
'qhhoj-backend': patch
---

New accounts default to the `Asia/Ho_Chi_Minh` time zone (was `America/Toronto`); existing accounts keep theirs. Logging in to an account that staff deactivated answers 403 `account_disabled` instead of `account_not_activated`.
