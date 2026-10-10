import { ApiParam, ApiTags } from '@nestjs/swagger';
import { Controller, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CurrentAuth, SessionOnly, setSessionCookie } from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { SessionResponse } from '../core/dto/session.response';
import { ImpersonationService } from './impersonation.service';

@ApiTags('Auth')
@Controller('api/internal/auth/impersonate')
export class ImpersonationController {
  constructor(
    private readonly impersonation: ImpersonationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Stop impersonating
   *
   * @remarks
   * Browser session only. Replaces the impersonation session with a fresh session of the superuser who started it. Errors: 400 `not_impersonating`, 401 `unauthorized` when that user is no longer an active superuser.
   */
  // find-my-way prefers the static 'stop' segment over ':userId'; a test pins this.
  @SessionOnly()
  @Post('stop')
  @HttpCode(200)
  async stop(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { sessionId, session, user, principal } =
      await this.impersonation.stop(auth);
    setSessionCookie(reply, sessionId, this.env.cookieSecure);
    return SessionResponse.from(user, principal, session);
  }

  /**
   * Impersonate a user
   *
   * @remarks
   * Superusers only, browser session only. Replaces the current session with one acting as the target user, whose last-login time is not touched; the response has `impersonatorId` set. Security changes (password, tokens, two-factor) are refused while impersonating.
   * Errors: 403 `forbidden` when already impersonating, not a superuser, or the target is a superuser; 404 `not_found` for an unknown or inactive user.
   */
  @ApiParam({ name: 'userId', description: 'Id of the user to act as.' })
  @SessionOnly()
  @Post(':userId')
  @HttpCode(200)
  async start(
    @CurrentAuth() auth: AuthContext,
    @Param('userId') userId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { sessionId, session, user, principal } =
      await this.impersonation.start(auth, userId);
    setSessionCookie(reply, sessionId, this.env.cookieSecure);
    return SessionResponse.from(user, principal, session);
  }
}
