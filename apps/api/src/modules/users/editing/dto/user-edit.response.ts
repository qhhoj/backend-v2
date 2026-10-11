import { uuidStr } from '@libs/database';
import type { Organization } from '@libs/database';
import type { UserDocument } from '@libs/auth';
import { OrganizationSummaryResponse } from '../../../organizations/core/dto/organization.response';

/** The fields staff edit on a user, plus the flags the panel needs to explain what it may do. */
export class UserEditResponse {
  id!: string;
  username!: string;
  /** Staff-set name shown in place of the username; empty when unset. */
  displayName!: string;
  /** The user's full name. */
  fullName!: string;
  /** About-me Markdown. */
  about!: string;
  email!: string;
  /** Memberships in the user's order. */
  organizations!: OrganizationSummaryResponse[];
  /** Rank title such as `user`, `admin` or `banned`. */
  displayRank!: string;
  isUnlisted!: boolean;
  mute!: boolean;
  allowTagging!: boolean;
  /** Staff-only notes; empty when unset. */
  notes!: string;
  /** Whether the user is in a contest now (it may have ended; cleared lazily). */
  inContest!: boolean;
  /** Whether TOTP or a security key is set up (reset through `reset-two-factor`). */
  hasTwoFactor!: boolean;
  isActive!: boolean;
  isStaff!: boolean;
  isSuperuser!: boolean;
  /** Null unless banned. */
  banReason!: string | null;
  dateJoined!: Date;
  lastLogin!: Date | null;

  static from(
    user: UserDocument,
    organizations: readonly Organization[],
  ): UserEditResponse {
    const byId = new Map(organizations.map((org) => [uuidStr(org._id), org]));
    return {
      id: uuidStr(user._id),
      username: user.username,
      displayName: user.usernameDisplayOverride,
      fullName: user.firstName,
      about: user.about ?? '',
      email: user.email,
      organizations: user.organizations
        .map((id) => byId.get(uuidStr(id)))
        .filter((org): org is Organization => org !== undefined)
        .map((org) => OrganizationSummaryResponse.from(org)),
      displayRank: user.displayRank,
      isUnlisted: user.isUnlisted,
      mute: user.mute,
      allowTagging: user.allowTagging,
      notes: user.notes ?? '',
      inContest: user.currentParticipation !== null,
      hasTwoFactor: user.isTotpEnabled || user.isWebauthnEnabled,
      isActive: user.isActive,
      isStaff: user.isStaff,
      isSuperuser: user.isSuperuser,
      banReason: user.banReason,
      dateJoined: user.dateJoined,
      lastLogin: user.lastLogin,
    };
  }
}

export class RenamedUserResponse {
  /** The login name now. */
  username!: string;
}
