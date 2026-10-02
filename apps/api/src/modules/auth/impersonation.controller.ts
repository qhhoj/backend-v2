import { Controller, HttpCode, Inject, Param, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  clearSessionCookie,
  CurrentAuth,
  SessionOnly,
  setSessionCookie,
} from '@libs/auth';
import type { AuthContext } from '@libs/auth';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { SessionResponse } from './dto/session.response';
import { ImpersonationService } from './impersonation.service';

@Controller('api/internal/auth/impersonate')
export class ImpersonationController {
  constructor(
    private readonly impersonation: ImpersonationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // Declared before ':userId' so "stop" is never captured as a user id.
  @SessionOnly()
  @Post('stop')
  @HttpCode(200)
  async stop(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { sessionId, session, user, principal } =
      await this.impersonation.stop(auth, () => {
        clearSessionCookie(reply);
      });
    setSessionCookie(reply, sessionId, this.env.cookieSecure);
    return SessionResponse.from(user, principal, session);
  }

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
