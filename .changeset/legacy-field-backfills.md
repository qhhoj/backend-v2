---
'qhhoj-backend': patch
---

The deploy's migrate step now fills fields that rows written before them lack (contests, participations, problems, test generations, users, languages, tickets) with the value every read already assumed, seals a Polygon API key still stored plain and redacts plain keys in its setting history. A contest or problem that lacked a visibility flag now matches every filter that tests the flag for false (lists, sitemap, home, user and organization pages, contest deletion, performance points and the cheating-ban count), as its own page already did; production has no such rows; an account with a TOTP flag but no key no longer shows two-factor as on.
