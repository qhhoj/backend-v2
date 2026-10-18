---
'qhhoj-backend': patch
---

Site contest creators (`judge.add_contest`) now scope a contest only to organizations they administer with `judge.create_private_contest`, on create, edit and clone (403 `organization_rights`). Before, they could scope a contest to any organization and charge that organization's credits. A contest that stays public may still list any organization. `judge.edit_all_contest` holders and superusers keep any organization.
