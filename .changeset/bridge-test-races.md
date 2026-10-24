---
'qhhoj-backend': patch
---

Bridge: a judge connection that drops during its key check no longer leaves a session that blocks bridge shutdown, and a judge blocked right after its Welcome gets the forced Disconnect. Bridge specs: two fixture races and a 500 ms test handshake deadline that failed them under host load are fixed.
