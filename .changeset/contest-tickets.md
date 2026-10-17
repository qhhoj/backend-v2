---
'qhhoj-backend': minor
---

Contest questions: `POST/GET /contests/:key/tickets` file and list tickets tied to a contest (optionally one of its problems by code); tickets carry `contest`, the `contest` link type exists, and the contest's editors read its tickets. Problem tickets filed from inside a contest are tied to it. Announcements render `#C` as a link to the contest's problem C.
