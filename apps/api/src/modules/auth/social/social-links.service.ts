import { Injectable } from '@nestjs/common';
import { hasUsablePassword, UsersRepository } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { AppError, conflictIssue } from '@libs/common';
import { AuthService } from '../core/auth.service';
import type { SocialLinksResponse } from './dto/social-links.response';
import { linkedProviders, socialProviderName } from './oauth-provider';

/** The signed-in user's own social sign-in links. */
@Injectable()
export class SocialLinksService {
  constructor(
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
  ) {}

  list(auth: AuthContext): SocialLinksResponse {
    return { providers: linkedProviders(auth.user.socialAuth) };
  }

  /** Needs the current password, so an account without a usable one sets one with the reset form first and never loses its last way to sign in. */
  async unlink(
    auth: AuthContext,
    slug: string,
    currentPassword: string,
  ): Promise<void> {
    if (!hasUsablePassword(auth.user.password))
      throw conflictIssue(
        'currentPassword',
        'password_unusable',
        'Set a password with the reset form first',
      );
    await this.auth.confirmPassword(auth, currentPassword);
    if (
      !(await this.users.unlinkSocial(auth.user._id, socialProviderName(slug)))
    )
      throw new AppError('not_found', 404, 'No such link');
  }
}
