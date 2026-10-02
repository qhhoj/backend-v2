import type { UserDocument } from './users.repository';

export const isActiveSuperuser = (
  user: UserDocument | null,
): user is UserDocument => !!user?.isActive && user.isSuperuser;
