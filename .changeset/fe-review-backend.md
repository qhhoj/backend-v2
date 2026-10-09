---
'qhhoj-backend': patch
---

Tickets: a reply or new ticket refused because the user is muted keeps 403 `forbidden` and adds `issues[{ field: '', code: 'muted' }]`, so the SPA can tell it from lost access. Contest replay: events of one participant in the same second keep submission order (ties no longer sort by problem), so the score no longer shows one solve of two.

Organization usage: a quota limit of 0 reports its meter as near and over (`isNearLimit`, `isOver` true) even with nothing used, matching `QuotaService`, which refuses every positive charge at limit 0 under enforce and logs it as over under warn.
