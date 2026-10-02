import { Principal, SessionData, UserDocument } from '@libs/auth';

export class UserResponse {
  id!: string;
  username!: string;
  email!: string;
  isStaff!: boolean;
  isSuperuser!: boolean;
  permissions!: string[];
  isTotpEnabled!: boolean;
  isWebauthnEnabled!: boolean;

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
    };
  }
}

export class SessionResponse {
  user!: UserResponse | null;
  csrfToken!: string | null;
  twoFactorRequired!: boolean;
  passwordChangeRequired!: boolean;

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
      passwordChangeRequired: session?.passwordPwned ?? false,
    };
  }
}
