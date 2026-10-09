---
'qhhoj-backend': minor
---

Tickets: `GET /api/internal/tickets/summary` returns `{assignedOpen, awaitingStaff}` (cached 15 s); tickets store `lastMessageByStaff`, set on every message.
