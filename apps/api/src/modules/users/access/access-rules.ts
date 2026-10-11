import { isKnownPermission } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, ValidationFailedError } from '@libs/common';
import type { FieldIssue } from '@libs/common';

/** Granting and revoking is a superuser's alone (user decision): no codename delegates it, so nobody grants what they do not hold. */
export function assertSuperuser(principal: Principal): void {
  if (!principal.isSuperuser)
    throw new AppError(
      'forbidden',
      403,
      'Only a superuser can grant or revoke access',
    );
}

/** Codenames of `next` the catalog lacks and `held` does not already have: legacy codenames may stay, never be added. Pure. */
export const unknownAdded = (
  next: readonly string[],
  held: readonly string[],
): string[] =>
  next.filter((code) => !isKnownPermission(code) && !held.includes(code));

export function assertKnownAdded(
  next: readonly string[],
  held: readonly string[],
): void {
  const unknown = unknownAdded(next, held);
  if (unknown.length)
    throw new ValidationFailedError('Unknown permission', [
      {
        field: 'permissions',
        code: 'permission_unknown',
        message: `Unknown permission: ${unknown.join(', ')}.`,
      },
    ]);
}

/** Each held codename with where it comes from, sorted. Pure. */
export function effectivePermissions(
  direct: readonly string[],
  groups: readonly { name: string; permissions: readonly string[] }[],
): { codename: string; direct: boolean; viaGroups: string[] }[] {
  const codes = new Set([
    ...direct,
    ...groups.flatMap((group) => group.permissions),
  ]);
  return [...codes].sort().map((codename) => ({
    codename,
    direct: direct.includes(codename),
    viaGroups: groups
      .filter((group) => group.permissions.includes(codename))
      .map((group) => group.name),
  }));
}

/** A codename or role both added and removed in one request. Pure. */
export function assertDisjoint(
  field: string,
  added: readonly string[] = [],
  removed: readonly string[] = [],
): void {
  if (added.some((item) => removed.includes(item)))
    throw new ValidationFailedError('Added and removed at once', [
      {
        field,
        code: 'added_and_removed',
        message: 'An item cannot be added and removed at once.',
      } satisfies FieldIssue,
    ]);
}
