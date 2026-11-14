import { isKnownPermission } from '@libs/auth';
import type {
  Principal,
  PrincipalService,
  UserDocument,
  UsersRepository,
} from '@libs/auth';
import { AppError } from '@libs/common';

/** The user staff act on: 404 when unknown; 403 for a superuser unless the caller is one, and for the caller themselves when `notSelf` (their own credentials have their own routes). */
export async function editableTarget(
  users: UsersRepository,
  principal: Principal,
  username: string,
  { notSelf = false } = {},
): Promise<UserDocument> {
  const user = await users.findByUsername(username);
  if (!user) throw new AppError('not_found', 404, 'No such user');
  if (user.isSuperuser && !principal.isSuperuser)
    throw new AppError(
      'forbidden',
      403,
      'Only a superuser can edit a superuser',
    );
  if (notSelf && user._id === principal.userId)
    throw new AppError('forbidden', 403, 'Use your own account settings');
  return user;
}

/** Rights that reach only the holder's own objects (decision 659's organization admin role): they give no power over other accounts or the site, so they never shield an account from staff. */
const OWN_SCOPE_PERMISSIONS: ReadonlySet<string> = new Set([
  'judge.edit_own_contest',
  'judge.edit_own_problem',
  'judge.create_organization_problem',
  'judge.create_private_contest',
]);

/** The target's rights that staff must hold too: catalog permissions (out-of-catalog legacy codenames grant nothing) beyond the own-scope ones. */
const shieldingRights = (rights: ReadonlySet<string>): string[] =>
  [...rights].filter(
    (right) => isKnownPermission(right) && !OWN_SCOPE_PERMISSIONS.has(right),
  );

/** 403 unless the caller holds every shielding permission the target holds (a superuser holds them all): staff change only accounts whose rights they already have. */
export function assertHoldsRightsOf(
  principals: PrincipalService,
  principal: Principal,
  target: UserDocument,
): void {
  if (principal.isSuperuser) return;
  const targetRights = principals.build(target).permissions;
  if (
    shieldingRights(targetRights).every((right) =>
      principal.permissions.has(right),
    )
  )
    return;
  throw new AppError(
    'forbidden',
    403,
    'This user holds permissions you do not have',
  );
}

/** `editableTarget` for a change to another account: never yourself, and only an account whose permissions the caller holds too. */
export async function changeableTarget(
  users: UsersRepository,
  principals: PrincipalService,
  principal: Principal,
  username: string,
): Promise<UserDocument> {
  const user = await editableTarget(users, principal, username, {
    notSelf: true,
  });
  assertHoldsRightsOf(principals, principal, user);
  return user;
}
