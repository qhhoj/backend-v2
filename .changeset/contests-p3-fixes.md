---
'qhhoj-backend': patch
---

Contest fixes: solve times before a participation's start count as 0; spectators submit as practice; `GET /site` returns the site `timeZone`; scope edits re-check members-only problems; lifting an automatic cheating ban no longer activates an inactive account; `rankingAccessCode` needs `judge.contest_access_code`; the public heatmap counts public problems only; `testcaseVisibility` C keeps output hidden on a contest submission until its contest ends; a ranking code sent to a contest without one no longer spends the code budget.
