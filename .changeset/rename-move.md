---
'qhhoj-backend': patch
---

A problem code rename moves the test data directory before it saves the code, so the problem stays judgeable. A failed move saves nothing, and a failed save moves the directory back unless the new code was stored. A taken target returns 400 `data_directory_taken`. Data that cannot be put back fails the edit with 500 `rename_data_stranded`.
