---
'qhhoj-backend': minor
---

Public `GET /runtimes` (judges with slots, ping and uptime; languages with per-judge compiler versions; no keys, addresses or builds). `GET /submissions/:id/source/raw` (inline) and `/source/download` (attachment, `<id>.<ext>`, `Main.java` for Java) as `text/plain` with `nosniff`, under the source's existing access rules.
