---
'qhhoj-backend': patch
---

An edit that makes a public problem visible to everyone by leaving organization privacy (a move onto the site, or clearing `isOrganizationPrivate`) now needs `judge.change_public_visibility`, including for `judge.edit_all_problem` holders (403 `site_publish_rights`). Before, an organization admin with `judge.add_problem` could publish a members-only problem to the whole site. Without the permission, an edit of `isPublic` or `isOrganizationPrivate` saves only while both still match what its gates checked (409 otherwise).
