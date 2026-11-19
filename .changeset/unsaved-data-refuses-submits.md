---
'qhhoj-backend': patch
---

A problem whose data was never saved (an `init.yml` without a data-version stamp) refuses submissions with `problem_has_no_tests` instead of judging them into internal errors.
