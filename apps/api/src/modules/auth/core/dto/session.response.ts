import { ApiProperty } from '@nestjs/swagger';
import { uuidStr } from '@libs/database';
import { AppearanceResponse } from '../../../users/profile/dto/profile.response';
import { Principal, SessionData, UserDocument } from '@libs/auth';

import {
  isTotpEnrolled,
  SECOND_FACTOR_METHODS,
  secondFactorMethods,
} from '../../two-factor/second-factor-methods';
import type { SecondFactorMethod } from '../../two-factor/second-factor-methods';

/** All a password-only session may learn: enough to draw the second-factor page. */
export class TwoFactorPendingResponse {
  /** Username of the account being signed in. */
  username!: string;
  /** Second factors the account can use to continue. */
  @ApiProperty({ enum: SECOND_FACTOR_METHODS, isArray: true })
  methods!: SecondFactorMethod[];
}

/** Where the user may create one kind of object; the SPA shows a create button when either is true. */
export class CreationScopeResponse {
  /** Site-wide: `judge.add_problem` for problems, `judge.add_contest` for contests. */
  site!: boolean;
  /** For at least one organization they administer: `judge.create_organization_problem` or `judge.create_private_contest` (`GET /organizations?administered=true` lists them). */
  organizations!: boolean;
}

/** Object rights the `permissions` list cannot tell, for deciding which admin screens to offer; the server still checks every object. */
export class AdminCapabilitiesResponse {
  /** Whether the user may administer at least one organization: an admin of one, or a holder of `judge.edit_all_organization`. */
  organizations!: boolean;
  /** Where the user may create problems. */
  problemCreation!: CreationScopeResponse;
  /** Where the user may create contests. */
  contestCreation!: CreationScopeResponse;
}

export class UserResponse {
  /** Stable user id. */
  id!: string;
  /** Unique login name. */
  username!: string;
  /** Contest rating; null while unrated. */
  rating!: number | null;
  /** Account email address. */
  email!: string;
  /** Whether the user is staff. */
  isStaff!: boolean;
  /** Whether the user is a superuser, who holds every permission. */
  isSuperuser!: boolean;
  /** Permission codenames the user holds (directly or through groups), sorted. */
  permissions!: string[];
  /** Object rights behind the admin screens, beside the permission codenames. */
  adminCapabilities!: AdminCapabilitiesResponse;
  /** Whether an authenticator app (TOTP) is set up. */
  isTotpEnabled!: boolean;
  /** Whether at least one security key is registered. */
  isWebauthnEnabled!: boolean;
  /** Theme id chosen in the profile. */
  siteTheme!: string;
  /** Custom accent and glass settings; null for the site default. */
  appearance!: AppearanceResponse | null;
  /** Default programming language id; null when none is chosen. */
  languageId!: string | null;

  static from(
    user: UserDocument,
    principal: Principal,
    adminCapabilities: AdminCapabilitiesResponse,
  ): UserResponse {
    return {
      id: user._id,
      username: user.username,
      rating: user.rating,
      email: user.email,
      isStaff: user.isStaff,
      isSuperuser: user.isSuperuser,
      permissions: [...principal.permissions].sort(),
      adminCapabilities,
      isTotpEnabled: isTotpEnrolled(user),
      isWebauthnEnabled: user.isWebauthnEnabled,
      siteTheme: user.siteTheme,
      appearance: user.appearance ?? null,
      languageId: user.languageId === null ? null : uuidStr(user.languageId),
    };
  }
}

export class SessionResponse {
  /** The signed-in user; null while a second factor is still pending. */
  user!: UserResponse | null;
  /** Token to send as `X-CSRF-Token` on non-GET requests; null for API tokens. */
  csrfToken!: string | null;
  /** True while the session has not passed its second factor. */
  twoFactorRequired!: boolean;
  /** What the second-factor page needs; null unless `twoFactorRequired` is true. */
  twoFactor!: TwoFactorPendingResponse | null;
  /** True when the password appears in a known breach and must be changed. */
  passwordChangeRequired!: boolean;
  /** Id of the superuser acting as this user; null when not impersonating. */
  impersonatorId!: string | null;

  static from(
    user: UserDocument,
    principal: Principal,
    session: SessionData | null,
    adminCapabilities: AdminCapabilitiesResponse,
  ): SessionResponse {
    const twoFactorRequired = session ? !session.twoFaPassed : false;
    return {
      user: twoFactorRequired
        ? null
        : UserResponse.from(user, principal, adminCapabilities),
      csrfToken: session?.csrf ?? null,
      twoFactorRequired,
      twoFactor: twoFactorRequired
        ? {
            username: user.username,
            methods: secondFactorMethods(user),
          }
        : null,
      passwordChangeRequired: session?.passwordPwned ?? false,
      impersonatorId: session?.impersonatorId ?? null,
    };
  }
}
