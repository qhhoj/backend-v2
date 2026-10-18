---
'qhhoj-backend': patch
---

Contests: an editor who creates contests only for organizations (no `judge.add_contest` or `judge.edit_all_contest`) can add, remove or flip only organizations they may create contests for, on edit and on clone, and cannot move a contest out of every organization (403 `organization_rights` / `site_contest_rights` on `organizations`). Opening a visible private contest to everyone needs `judge.change_contest_visibility`. A save that changes organizations holds only while the stored organizations are unchanged (409 otherwise).
