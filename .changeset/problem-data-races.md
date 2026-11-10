---
'qhhoj-backend': patch
---

Problem test data: an upload or data change whose problem was renamed meanwhile is refused (409 `conflict`, issue `problem_renamed`) instead of leaving an empty directory at the old code, and an empty leftover directory no longer blocks reusing a code. A chunked complete or cancel reads the stored archive only once every chunk is received and the upload budget allows it. A problem package is never built from data that is being written (the build waits briefly) or whose last save did not finish (409, "save the test data again"); such refusals give the package request back.
