---
'qhhoj-backend': patch
---

Moving a problem between organizations keeps its code: the organization prefix is checked only for a new code (and on create and import), not on a move, a flip to private or a reorder.
