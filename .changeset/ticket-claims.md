---
'qhhoj-backend': minor
---

Tickets: `POST`/`DELETE /tickets/{id}/claim` takes a ticket or hands it back (staff and editors of the linked problem; a second claimer gets 409 `ticket_claimed`, also when both click at once; a closed ticket 409 `ticket_closed`), `can.claim` on the detail, list filters `aboutMine` (tickets about the caller's own problems) and `q` (title text ignoring accents, or creator username), and `aboutMineOpen` in the ticket summary.
