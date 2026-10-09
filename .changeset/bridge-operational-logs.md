---
'qhhoj-backend': patch
---

Bridge: logs judge connects (address, build, slots, resumed/dropped runs) and disconnects with the reason, RETRY answers with the judge's reason, grace holds and outcomes, accept timeouts, and sockets that close before authenticating (failed TLS/HTTP2 handshakes, throttled per address); server-side failures name the submission, generation and seq. A grace expiry whose write fails is retried at the next expiry instead of falling to the free stranded-run reset.
