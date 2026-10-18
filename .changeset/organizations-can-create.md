---
'qhhoj-backend': minor
---

`GET /organizations?canCreate=problem|contest` lists the organizations the viewer may create that for (administrator, or `judge.edit_all_organization`, holding `judge.create_organization_problem` or `judge.create_private_contest`): the set the organization create routes accept. 401 when anonymous.
