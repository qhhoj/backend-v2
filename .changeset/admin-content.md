---
'qhhoj-backend': minor
---

Admin content: `GET /admin/comments` (search every comment) and `POST /admin/comments/hidden` (bulk hide); `/admin/posts` takes `search` and the `organization` and `any` states; `visible`, `sticky` or `globalPost` sent alone by `edit_all_post` skips the post write limit; `/admin/discord-webhooks` lists masked targets, sets or removes one event and queues a test message; a `discord.webhooks` patch now merges per event (null removes one).
