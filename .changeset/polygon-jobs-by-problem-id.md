---
'qhhoj-backend': patch
---

Import jobs and Polygon sync runs follow the problem's id, not its code, so a renamed problem's job is never shown to another problem's editors and a failed run lands in the right history; the all-problems sync history needs `judge.edit_own_problem` as well as `judge.edit_all_problem`; the cached statement PDFs are dropped after every import that wrote statements, also one that ends needing attention.
