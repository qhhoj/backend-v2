---
'qhhoj-backend': patch
---

Register and join take `acceptRulesRevision` and answer 409 `rules_changed` when the rules were saved after the user read them.
