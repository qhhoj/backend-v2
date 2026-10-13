---
'qhhoj-backend': minor
---

Problem editors may move a problem between organizations, and between the site and an organization, with the organization creation rights in every organization added or removed (403 `organization_rights`) and `judge.add_problem` to leave all organizations (403 `site_problem_rights`). The code is never renamed (400 `organization_code_prefix`); a move into an organization spends its problem credits and must fit its storage.
