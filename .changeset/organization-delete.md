---
'qhhoj-backend': minor
---

Add `DELETE /organizations/{slug}`: a superuser-only soft delete. Problems and contests are unlinked and keep their privacy flags, posts are unlinked and hidden, members are released and pending join requests rejected. Deleted organizations disappear from every read.
