---
'qhhoj-backend': minor
---

Balloon volunteers and editors get the balloon queue of a contest with balloons on: `GET /contests/:key/balloons` (pending, delivered or all, paged, with badge totals) and `POST .../balloons/:participation/:problem/deliver|undeliver`. The queue is derived from the live scores; a contestant is refused, and while the contest is frozen a non-editor sees no solve times or totals and the read is logged. Refusals carry `error.issues[].code`.
