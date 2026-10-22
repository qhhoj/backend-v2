---
'qhhoj-backend': patch
---

Problem create, suggest and clone refuse a code whose test data directory already exists (400 `data_directory_taken`). A Polygon import takes the data lock before its commit, waiting up to 60 s for an API data write, so a committed import no longer leaves its files unwritten.
