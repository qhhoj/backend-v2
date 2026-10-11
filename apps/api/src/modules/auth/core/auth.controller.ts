import { ApiTags } from '@nestjs/swagger';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  AllowBeforeTwoFactor,
  AllowPwnedPassword,
  clearSessionCookie,
  CurrentAuth,
  NoImpersonation,
  Public,
  SessionService,
  SessionOnly,
  setSessionCookie,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CurrentPasswordDto } from './dto/current-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegenerateTokenResponse } from './dto/token.response';
import { SessionResponse } from './dto/session.response';

@ApiTags('Auth')
@Controller('api/internal/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Sign in with a username and password
   *
   * @remarks
   * Public. Verifies the credentials and opens a browser session: the `qhhoj_session` cookie is set and any session the browser already held is replaced. Send the returned `csrfToken` in the `X-CSRF-Token` header on every later non-GET request.
   * When the account has TOTP or a security key, `twoFactorRequired` is true and `user` is null until the second factor is passed. When the password appears in a known breach, `passwordChangeRequired` is true and only the password change works.
   * Failed attempts are limited per IP and per account from that IP (10 in 15 minutes, then 429 `rate_limited`), so failures from elsewhere never lock the owner out. Errors: 401 `invalid_credentials`, 403 `banned` (carries the ban reason), 403 `account_not_activated`.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { sessionId, session, user, principal } = await this.auth.login(
      body.username,
      body.password,
      request.ip,
      request.auth?.sessionId ?? null,
    );
    setSessionCookie(reply, sessionId, this.env.cookieSecure);
    return SessionResponse.from(user, principal, session);
  }

  /**
   * Get the current session and user
   *
   * @remarks
   * Signed-in callers only (cookie session or API token); also served while a second factor or a password change is still pending. Returns the same shape as login: the user with their permission codenames, the CSRF token of the session, and the pending second-factor methods when `twoFactorRequired` is true.
   * An API token has no session, so `csrfToken` is null for it.
   */
  @AllowBeforeTwoFactor()
  @AllowPwnedPassword()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): SessionResponse {
    return SessionResponse.from(auth.user, auth.principal, auth.session);
  }

  /**
   * Sign out of the current session
   *
   * @remarks
   * Signed-in callers only. Destroys the current session on the server and clears the `qhhoj_session` cookie. Other sessions of the user stay valid. Returns 204.
   */
  @AllowBeforeTwoFactor()
  @AllowPwnedPassword()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (auth.sessionId) await this.sessions.destroy(auth.sessionId);
    clearSessionCookie(reply);
  }

  /**
   * Sign out of every session
   *
   * @remarks
   * Browser session only (API tokens get 403) and not while impersonating. Destroys all sessions of the user, including the current one, revokes the API token and clears the cookie. Returns 204.
   */
  @SessionOnly()
  @NoImpersonation()
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logoutAll(auth.principal.userId);
    clearSessionCookie(reply);
  }

  /**
   * Change the account password
   *
   * @remarks
   * Browser session only, not while impersonating; reachable while the password is flagged as breached. Requires the current password; wrong attempts share the 10 in 15 minutes budget with other password confirmations (400 `invalid_credentials`, then 429 `rate_limited`).
   * The new password must pass the password policy, differ from the current one and not appear in a known breach, otherwise 400 `validation_failed` with per-field issues on `newPassword`. All other sessions are signed out and the API token is revoked. A concurrent change gives 409 `conflict`. Returns 204.
   */
  @SessionOnly()
  @NoImpersonation()
  @AllowPwnedPassword()
  @Post('password/change')
  @HttpCode(204)
  changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() body: ChangePasswordDto,
  ): Promise<void> {
    return this.auth.changePassword(
      auth,
      body.currentPassword,
      body.newPassword,
    );
  }

  /**
   * Create a new API token
   *
   * @remarks
   * Browser session only, not while impersonating. Requires the current password; wrong attempts share the 10 in 15 minutes budget with other password confirmations (400 `invalid_credentials`, then 429 `rate_limited`).
   * Issues a new personal API token for `Authorization: Bearer`, replacing the previous one, which stops working at once. The token is shown only in this response. A password change, a password reset and signing out everywhere revoke it.
   */
  @SessionOnly()
  @NoImpersonation()
  @Post('token/regenerate')
  regenerateToken(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CurrentPasswordDto,
  ): Promise<RegenerateTokenResponse> {
    return this.auth.regenerateApiToken(auth, body.currentPassword);
  }
}
