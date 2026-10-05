interface PermissionHolder {
  permissions: readonly string[];
}

/** Everything the user holds directly plus what their groups grant. Superuser and active state are the caller's concern (`hasPermission`, the auth guard). */
export const permissionsOf = (
  user: PermissionHolder,
  groups: readonly PermissionHolder[],
): Set<string> =>
  new Set([
    ...user.permissions,
    ...groups.flatMap((group) => group.permissions),
  ]);
