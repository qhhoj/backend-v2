---
'qhhoj-backend': minor
---

Contest tag catalogue: `GET /contest-tags` (public) and `POST|PATCH|DELETE /contest-tags` (`judge.change_contest_tag`); colours are theme token keys, at most 100 tags (409 `tag_limit`). The `grant-permissions` migrator command gives the new codename to holders of `judge.edit_all_contest`.
