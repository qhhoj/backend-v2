---
'qhhoj-backend': patch
---

Problem test data: an upload or data change whose problem was renamed meanwhile is refused (409 `conflict`) instead of leaving an empty directory at the old code, and an empty leftover directory no longer blocks reusing a code. A chunked complete or cancel reads the stored archive only once every chunk is received and the upload budget allows it. A problem package is never built from data that is being written or whose stamp is behind.
