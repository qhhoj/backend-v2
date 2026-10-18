---
'qhhoj-backend': minor
---

Contest questions: `POST/GET /contests/:key/tickets` file and list tickets tied to a contest (optionally one of its problems by code); tickets carry `contest`, the `contest` link type exists, and the contest's editors read its tickets. Problem tickets filed from inside a contest are tied to it. Announcements render `#C` as `<a class="problem-ref">`: with the problem's href once its code is public to the contest's viewers (ended, or a visible board after the start), label-only before that for the reader's page to resolve.
