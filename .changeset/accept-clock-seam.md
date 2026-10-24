---
"qhhoj-backend": patch
---

bridge: the Accepted window of an Assign is timed through an injectable `AcceptClock` (`ACCEPT_CLOCK`; production keeps one real `acceptMs` timer per Assign). The conformance runner uses a manual clock, so the accept-timeout scenarios (28, 28b, 28c) no longer depend on host timing.
