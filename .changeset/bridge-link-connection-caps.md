---
'qhhoj-backend': patch
---

Bridge judge link: one connection and one handshake per judge; a connection whose last session ended closes after 15 s; a block, key rotation or forced disconnect ends every session of the judge (handshakes included) and closes its connections; an address with 20 failed key checks a minute is refused and logged; no session opens while the bridge stops.
