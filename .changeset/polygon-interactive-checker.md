---
'qhhoj-backend': patch
---

Polygon import: an interactive problem's checker runs after the interactor (`interactive.checker`), bridged checkers compile with the package's headers, and both checker and interactor get a compile check at import. The bridge sends such problems only to judges that advertise `interactive.checker`. A sync that keeps a local grader keeps its `interactiveChecker` too, and an import compile-checks only the sources it wrote.
