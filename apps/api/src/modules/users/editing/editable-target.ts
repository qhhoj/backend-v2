import type { Principal, UserDocument, UsersRepository } from '@libs/auth';
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
