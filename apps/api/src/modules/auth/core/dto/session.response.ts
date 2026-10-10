import { ApiProperty } from '@nestjs/swagger';
import { uuidStr } from '@libs/database';
import { AppearanceResponse } from '../../../users/profile/dto/profile.response';
import { Principal, SessionData, UserDocument } from '@libs/auth';

import {
  SECOND_FACTOR_METHODS,
  secondFactorMethods,
} from '../../two-factor/second-factor-methods';
import type { SecondFactorMethod } from '../../two-factor/second-factor-methods';

/** All a password-only session may learn: enough to draw the second-factor page. */
export class TwoFactorPendingResponse {
  username!: string;
  @ApiProperty({ enum: SECOND_FACTOR_METHODS, isArray: true })
  methods!: SecondFactorMethod[];
}

export class UserResponse {
  id!: string;
  username!: string;
  email!: string;
  isStaff!: boolean;
  isSuperuser!: boolean;
  permissions!: string[];
  isTotpEnabled!: boolean;
  isWebauthnEnabled!: boolean;
  siteTheme!: string;
  appearance!: AppearanceResponse | null;
  languageId!: string | null;

  static from(user: UserDocument, principal: Principal): UserResponse {
    return {
      id: user._id,
      username: user.username,
      email: user.email,
      isStaff: user.isStaff,
      isSuperuser: user.isSuperuser,
      permissions: [...principal.permissions].sort(),
      isTotpEnabled: user.isTotpEnabled,
      isWebauthnEnabled: user.isWebauthnEnabled,
      siteTheme: user.siteTheme,
      appearance: user.appearance ?? null,
      languageId: user.languageId === null ? null : uuidStr(user.languageId),
    };
  }
}

export class SessionResponse {
  user!: UserResponse | null;
  csrfToken!: string | null;
  twoFactorRequired!: boolean;
  twoFactor!: TwoFactorPendingResponse | null;
  passwordChangeRequired!: boolean;
  impersonatorId!: string | null;

  static from(
    user: UserDocument,
    principal: Principal,
    session: SessionData | null,
  ): SessionResponse {
    const twoFactorRequired = session ? !session.twoFaPassed : false;
    return {
      user: twoFactorRequired ? null : UserResponse.from(user, principal),
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
