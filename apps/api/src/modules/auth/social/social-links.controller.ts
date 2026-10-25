import { ApiParam, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, HttpCode, Param } from '@nestjs/common';
import { CurrentAuth, NoImpersonation, SessionOnly } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { CurrentPasswordDto } from '../core/dto/current-password.dto';
import { SocialLinksResponse } from './dto/social-links.response';
import { SocialLinksService } from './social-links.service';

/** Account settings, so not under the public sign-in controller: browser session only, not while impersonating. */
@SessionOnly()
@NoImpersonation()
@ApiTags('Auth')
@Controller('api/internal/auth/social/links')
export class SocialLinksController {
  constructor(private readonly links: SocialLinksService) {}

  /**
   * List your social sign-in links
   *
   * @remarks
   * Browser session only, not while impersonating. Returns the slugs of the providers that sign in to this account.
   */
  @Get()
  list(@CurrentAuth() auth: AuthContext): SocialLinksResponse {
    return this.links.list(auth);
  }

  /**
   * Remove a social sign-in link
   *
   * @remarks
   * Browser session only, not while impersonating. Requires the current password in the body (400 `invalid_credentials`, then 429 `rate_limited`, sharing the budget of other password confirmations). The provider no longer signs in to this account; sessions already open stay until you sign out everywhere.
   * Errors: 409 `conflict` with issue `password_unusable` when the account has no password yet (set one with the reset form first, so the account keeps a way to sign in), 404 `not_found` when no such link exists. Returns 204.
   */
  @ApiParam({
    name: 'provider',
    description: 'Provider slug from `GET /auth/social/links`.',
  })
  @Delete(':provider')
  @HttpCode(204)
  unlink(
    @CurrentAuth() auth: AuthContext,
    @Param('provider') provider: string,
    @Body() body: CurrentPasswordDto,
  ): Promise<void> {
    return this.links.unlink(auth, provider, body.currentPassword);
  }
}
