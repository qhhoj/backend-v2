---
'qhhoj-backend': patch
---

The deploy's migrate step now fills fields that rows written before them lack (contests, participations, problems, test generations, users, languages, tickets) with the value every read already assumed, seals a Polygon API key still stored plain and redacts plain keys in its setting history. Lists now include a contest or problem that lacked a visibility flag, as its own page already did; an account with a TOTP flag but no key no longer shows two-factor as on.
