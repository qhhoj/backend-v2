import type { Document } from 'mongodb';
import type { Permission } from '@libs/auth';

/** A codename that did not exist in the legacy site: every group and every user holding `heldBy` directly gets `permission`. Anchors, not group names, because migrated group names are the operator's. Later programs append their own rows. */
export interface PermissionGrant {
  permission: Permission;
  heldBy: Permission;
}

export const PERMISSION_GRANTS: readonly PermissionGrant[] = [
  { permission: 'judge.change_contest_tag', heldBy: 'judge.edit_all_contest' },
  { permission: 'judge.delete_problem', heldBy: 'judge.edit_all_problem' },
  {
    permission: 'judge.manage_short_link',
    heldBy: 'flatpages.change_flatpage',
  },
  { permission: 'judge.manage_integration', heldBy: 'judge.change_miscconfig' },
];

/** `doc` without the granted codenames of the anchors it holds, so `verify` passes before and after `grant-permissions` ran; a granted codename on a holder of no anchor (real drift, or a legacy row that already had it) still counts. */
export const withoutGrantedPermissions = (doc: Document): Document => {
  if (!Array.isArray(doc.permissions)) return doc;
  const held = new Set<string>(doc.permissions);
  const added = new Set(
    PERMISSION_GRANTS.filter(({ heldBy }) => held.has(heldBy)).map(
      ({ permission }) => permission,
    ),
  );
  return {
    ...doc,
    permissions: doc.permissions.filter(
      (codename: string) => !added.has(codename),
    ),
  };
};
