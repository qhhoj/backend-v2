---
'qhhoj-backend': minor
---

Sync API v1: `PUT /api/sync/v1/contests/:key/participants` replaces the contestant list with the active users found (case-insensitive) and returns the unknown usernames (never creates users; at any time for an owned contest); `DELETE /api/sync/v1/contests/:key` removes a hidden, unstarted contest with no submissions together with its participations, announcements, public ranking link, ghosts and final-judge job (else `409 contest_not_deletable`); `GET /api/sync/v1/contests/:key/standings` serves the public board, frozen during a freeze (`403 board_hidden` when the contest hides it). Keys the client does not own are the same 404 as missing keys.
