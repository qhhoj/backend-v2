---
'qhhoj-backend': patch
---

Bridge: a judge connection that drops during its key check no longer leaves a session that blocks bridge shutdown; a judge blocked right after its Welcome gets the forced Disconnect; the per-session flood cap counts messages as they arrive, so it holds on a busy bridge. Bridge DB specs no longer depend on host load.
