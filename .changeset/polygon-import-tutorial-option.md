---
'qhhoj-backend': minor
---

Polygon and zip imports take `importTutorial` (default true), independent of `appendMainSolution`. False imports no tutorial: a new problem gets no editorial (or only the main-solution block), and an update, re-import or sync leaves the problem's editorial untouched. The Polygon link stores it with its options (`PATCH /problems/{code}/polygon`), so a sync keeps the choice; links and jobs made before it behave as true.
