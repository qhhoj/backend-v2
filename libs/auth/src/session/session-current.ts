import { isActiveSuperuser } from '../users/active-superuser';
import type { UserDocument, UsersRepository } from '../users/users.repository';
import type { SessionData } from './session.service';

/**
 * Whether a session still stands for `user`: the user is active and has revoked no credential since it was issued, and
 * an impersonation's impersonator is still an active superuser at the epoch it started under. The guard checks it on
 * every request and the event streams on every recheck.
 */
export async function sessionCurrent(
  users: Pick<UsersRepository, 'findById'>,
  session: SessionData,
  user: UserDocument,
): Promise<boolean> {
  if (!user.isActive || user.credentialEpoch !== session.credentialEpoch)
    return false;
  if (!session.impersonatorId) return true;
  const impersonator = await users.findById(session.impersonatorId);
  return (
    isActiveSuperuser(impersonator) &&
    impersonator.credentialEpoch === session.impersonatorEpoch
  );
}
