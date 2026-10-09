---
'qhhoj-backend': minor
---

Bridge: judges connect over gRPC `qhhoj.judge.v1` (TLS unless the port is loopback; `x-judge-name`/`x-judge-key` metadata checked before any message); runs resume after a reconnect within 30 s; a bridge start no longer requeues P/G rows. The DMOJ judge transport is removed.
