---
'qhhoj-backend': minor
---

Staff user administration under `/admin/users`: `GET`/`PATCH {username}/profile` (display name, full name, about, display rank, unlisted, mute, allow tagging, staff notes, leave current contest, organizations with `judge.change_profile`; e-mail and active flag also need `auth.change_user`), `POST {username}/password` (admin re-enters their own password; revokes the user's sessions and API token; 10 per admin per hour), `POST {username}/password-reset` and `POST {username}/rename` (old name still opens the profile), all `auth.change_user`; `POST /admin/users` creates up to 100 accounts per request (`auth.add_user`; generated password or invite mail, optional organization). Superusers are editable only by superusers; every action is a `user` revision without secrets.
