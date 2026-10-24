---
'qhhoj-backend': patch
---

bridge: the resume grace of a lost judge's runs and the handshake deadlines (socket and Hello) are timed through injectable clocks (`GRACE_CLOCK`, `HANDSHAKE_CLOCK`; production keeps one real timer each). The conformance runner drives them from the transcript, waits before each `api` and `wait` step until the bridge has handled every judge message, and ends an `api` step once the bridge has applied the command, so 04, 23 and 33 no longer depend on host timing.
