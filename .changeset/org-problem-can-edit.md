---
'qhhoj-backend': patch
---

Organizations: each row of `GET /organizations/:slug/problems` (and the tag write's answer) carries `canEdit`, whether the viewer may edit that problem, so the organization's problem list can show a pencil to its editor.
