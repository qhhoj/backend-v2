---
'qhhoj-backend': minor
---

`POST /organizations/{slug}/problems` and `POST /organizations/{slug}/contests` create organization-private problems and contests for the organization's administrators who hold `judge.create_organization_problem` / `judge.create_private_contest` (no `add_problem` / `add_contest`). Organization problem codes must start with the slug prefix (`thpt-demo` → `thptdemo_`, 400 `organization_code_prefix`; superusers exempt; checked again only when the code or organizations change). Organization problem creators may set `isPublic` (members only) on their organization's private problems. The organization `viewer` gains `canCreateProblem` / `canCreateContest`; session `adminCapabilities` gains `problemCreation` / `contestCreation` (`{ site, organizations }`).
