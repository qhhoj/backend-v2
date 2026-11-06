---
'qhhoj-backend': patch
---

A problem's cached packages are dropped when a PDF statement is rendered, so a package built before the render is rebuilt with the PDF instead of being served as current.
