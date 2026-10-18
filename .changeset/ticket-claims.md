---
'qhhoj-backend': minor
---

Tickets: `POST`/`DELETE /tickets/{id}/claim` takes a ticket or hands it back (staff, editors of the linked problem and editors of the contest it was filed from; a second claimer gets 409 `ticket_claimed`, also when both click at once; a closed ticket 409 `ticket_closed`), `can.claim` on the detail, list filters `aboutMine` (tickets about the caller's own problems, and tickets filed from contests they author or curate) and `q` (title text ignoring accents, or creator username), and `aboutMineOpen` in the ticket summary.
