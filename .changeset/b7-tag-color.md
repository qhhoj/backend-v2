---
'qhhoj-backend': minor
---

OpenAPI: the contest and organization tag colour enumeration is one `TagColor` schema (was `ContestTagColor`, used by both). Same values; SDK consumers importing `ContestTagColor` must switch to `TagColor` (regenerate the SDK).
