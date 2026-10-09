import type { Permission } from '@libs/auth';

/** A codename that did not exist in the legacy site: every group holding `heldBy` gets `permission`. Anchors, not group names, because migrated group names are the operator's. Later programs append their own rows. */
export interface PermissionGrant {
  permission: Permission;
  heldBy: Permission;
}

export const PERMISSION_GRANTS: readonly PermissionGrant[] = [
  { permission: 'judge.change_contest_tag', heldBy: 'judge.edit_all_contest' },
  { permission: 'judge.delete_problem', heldBy: 'judge.edit_all_problem' },
];
