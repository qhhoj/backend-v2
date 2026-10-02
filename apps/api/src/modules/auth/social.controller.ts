import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public, setSessionCookie } from '@libs/auth';
import { ENV } from '@libs/common';
import type { Env } from '@libs/common';
import { SessionResponse } from './dto/session.response';
import { SocialCompleteDto } from './dto/social-complete.dto';
import { SocialService } from './social.service';

const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_PATH = '/api/internal/auth/social';
const STATE_COOKIE_SECONDS = 600;

@Public()
@Controller('api/internal/auth/social')
export class SocialController {
  constructor(
    private readonly social: SocialService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { location, state } = await this.social.start(provider);
    // Ties the flow to this browser, so a victim cannot be logged in via an attacker's callback link.
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.env.cookieSecure,
      sameSite: 'lax',
      path: STATE_COOKIE_PATH,
      maxAge: STATE_COOKIE_SECONDS,
    });
    reply.redirect(location, 302);
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const text = (value: unknown) =>
      typeof value === 'string' ? value : undefined;
    const { location, sessionId } = await this.social.callback(provider, {
      code: text(query.code),
      state: text(query.state),
      error: text(query.error),
      stateCookie: request.cookies[STATE_COOKIE],
    });
    reply.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });
    if (sessionId) setSessionCookie(reply, sessionId, this.env.cookieSecure);
    reply.redirect(location, 302);
  }

  @Post('complete')
  @HttpCode(200)
  async complete(
    @Body() body: SocialCompleteDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const { sessionId, session, user, principal } = await this.social.complete(
      body,
      request.ip,
    );
    setSessionCookie(reply, sessionId, this.env.cookieSecure);
    return SessionResponse.from(user, principal, session);
  }
}
