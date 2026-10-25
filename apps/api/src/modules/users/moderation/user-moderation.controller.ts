import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  CurrentAuth,
  NoImpersonation,
  RequirePermission,
  SessionOnly,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { UsernameParamDto } from '../core/dto/username-params.dto';
import { BanDto } from './dto/ban.dto';
import { UserModerationService } from './user-moderation.service';

@ApiTags('Admin: users')
@Controller('api/internal/users')
export class UserModerationController {
  constructor(private readonly moderation: UserModerationService) {}

  /**
   * Ban a user
   *
   * @remarks
   * Requires `judge.ban_user`. Deactivates the account, hides it from the leaderboards, sets its rank to `banned`, records the reason, signs the user out everywhere and revokes their API token. Errors: 400 `validation_failed` for the reason reserved to automatic contest-cheating bans, 403 `forbidden` when targeting yourself or a superuser, 404 `not_found`, 409 `conflict` when already banned. Returns 204.
   */
  @Post(':username/ban')
  @HttpCode(204)
  @RequirePermission('judge.ban_user')
  ban(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
    @Body() { reason }: BanDto,
  ): Promise<void> {
    return this.moderation.ban(auth.principal, username, reason);
  }

  /**
   * Unban a user
   *
   * @remarks
   * Requires `judge.ban_user`. Restores the account as an active, listed `user`, whatever rank it had before. Errors: 403 `forbidden` when targeting yourself or a superuser, 404 `not_found`, 409 `conflict` when the user is not banned. Returns 204.
   */
  @Post(':username/unban')
  @HttpCode(204)
  @RequirePermission('judge.ban_user')
  unban(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
  ): Promise<void> {
    return this.moderation.unban(auth.principal, username);
  }

  /**
   * Reset a user's two-factor sign-in
   *
   * @remarks
   * Requires `judge.ban_user` and a browser session (API tokens get 403), not while impersonating, like the other staff credential routes. Removes the user's authenticator app and all security keys so a locked-out user can sign in again, signs them out everywhere and records a `user` revision for audit. Errors: 403 `forbidden` when targeting yourself or a superuser, 404 `not_found`. Returns 204.
   */
  @SessionOnly()
  @NoImpersonation()
  @Post(':username/reset-two-factor')
  @HttpCode(204)
  @RequirePermission('judge.ban_user')
  resetTwoFactor(
    @CurrentAuth() auth: AuthContext,
    @Param() { username }: UsernameParamDto,
  ): Promise<void> {
    return this.moderation.resetTwoFactor(auth.principal, username);
  }
}
