---
'qhhoj-backend': patch
---

Every UUID body, query and path field is lowercased before use, so an uppercase id acts exactly like the lowercase one. Fixes: moving a problem into an organization named by an uppercase id skipped its storage limit and its code prefix; kicking a co-admin named by an uppercase id removed them instead of answering 409 `admin_not_kickable`.
