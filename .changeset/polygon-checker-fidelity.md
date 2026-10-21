---
'qhhoj-backend': patch
---

Polygon import: run every `std::*` checker except hcmp from the package's own `check.cpp` (bridged), keep the checker of interactive problems, and stage the package's headers (its `testlib.h` included) beside the checker and interactor.
