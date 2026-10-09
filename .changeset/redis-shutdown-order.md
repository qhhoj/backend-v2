---
'qhhoj-backend': patch
---

The shared Redis client now closes last on shutdown (`onApplicationShutdown`), so the api's final activity flush and jobs still running when the worker stops no longer fail with "Connection is closed".

The bridge's FetchSource now waits for the file stream to close before it closes the file handle, so a cancelled fetch no longer leaves the descriptor open for a moment after it returns.
