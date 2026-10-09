---
'qhhoj-backend': minor
---

Daily `problem-purge` job (03:30 site time): a problem deleted longer ago than `problem.deleteGraceDays` loses its data directory, PDFs, packages, uploads, comments and revisions and becomes a tombstone (code and name); every submission is kept. A purge that died (claim older than an hour) is finished by the next sweep, also for a purge-now inside the grace period. A symlinked data directory is refused.
