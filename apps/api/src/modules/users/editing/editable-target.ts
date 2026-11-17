import { shieldingRights } from '@libs/auth';
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
