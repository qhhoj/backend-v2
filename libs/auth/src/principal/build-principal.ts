import { uuidStr } from '@libs/database';
import { permissionsOf } from './permissions-of';
import type { Principal } from './principal';

interface PrincipalSource {
  _id: Parameters<typeof uuidStr>[0];
  username: string;
  isSuperuser: boolean;
  isStaff: boolean;
  permissions: readonly string[];
  organizations: readonly Parameters<typeof uuidStr>[0][];
}

/** The one place a `Principal` is assembled from a user row and the groups they belong to (the api's `PrincipalService` and the worker's publish editor both call it). */
export function buildPrincipal(
  user: PrincipalSource,
  groups: readonly { permissions: readonly string[] }[],
): Principal {
  return {
    userId: uuidStr(user._id),
    username: user.username,
    isSuperuser: user.isSuperuser,
    isStaff: user.isStaff,
    permissions: permissionsOf(user, groups),
    organizationIds: user.organizations.map(uuidStr),
  };
}
