---
'qhhoj-backend': patch
---

Feed: a locked IP gets the same 429 for every contest key; the stream is documented as `application/x-ndjson`; a format switch rebuilds the shared build; contest feed streams have their own cap (100) and the public submission feed cap is 900. Export: the download is `private, no-store`, and a problem deleted since the contest keeps its CSV rows but not its sources. Problems: a contest save that a delete overtook is refused and undone; delete and restore drop the public feed's cached eligibility at once; upload deletes refuse a symlink out of `MEDIA_ROOT`.
