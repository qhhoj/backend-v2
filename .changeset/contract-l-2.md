---
'qhhoj-backend': patch
---

Archive uploads read every entry, so a bad size or checksum is refused at upload; folder records get the same method and bounds checks as files, and a repeated folder record is refused.
