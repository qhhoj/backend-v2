---
'qhhoj-backend': patch
---

Event streams no longer spend the daily session-cookie refresh, a session short of 2FA or the password gate counts as a visitor in activity logs, access times and submission streams (the visitor detail limit applies when a submission stream opens), the "nested too deeply" 400 carries `issues`, and the signup e-mail lock is renewed while a slow signup waits for its password hash.
