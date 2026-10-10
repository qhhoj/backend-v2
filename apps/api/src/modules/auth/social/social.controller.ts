import { ApiParam, ApiTags } from '@nestjs/swagger';
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
import { SessionResponse } from '../core/dto/session.response';
import { SocialCompleteDto } from './dto/social-complete.dto';
import { SocialProvidersResponse } from './dto/social-providers.response';
import { SocialService, STATE_TTL_SECONDS } from './social.service';

const STATE_COOKIE = 'oauth_state';
const STATE_COOKIE_PATH = '/api/internal/auth/social';
const PENDING_COOKIE = 'oauth_pending';

@Public()
@ApiTags('Auth')
@Controller('api/internal/auth/social')
export class SocialController {
  constructor(
    private readonly social: SocialService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * List enabled social sign-in providers
   *
   * @remarks
   * Public. Returns the slugs of the OAuth providers that are configured, for the login page buttons.
   */
  @Get('providers')
  providers(): SocialProvidersResponse {
    return { providers: this.social.enabledProviders() };
  }

  /**
   * Begin a social sign-in
   *
   * @remarks
   * Public. Redirects (302) the browser to the provider's authorization page and sets a short-lived `oauth_state` cookie that ties the flow to this browser. Limited to 30 starts per IP per 10 minutes (429 `rate_limited`); 404 `not_found` for an unknown provider.
   */
  @ApiParam({
    name: 'provider',
    description: 'Provider slug, one of `GET /auth/social/providers`.',
  })
  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { location, state } = await this.social.start(provider, request.ip);
    // Ties the flow to this browser, so a victim cannot be logged in via an attacker's callback link.
    this.setFlowCookie(reply, STATE_COOKIE, state);
    reply.redirect(location, 302);
  }

  /**
   * Finish a social sign-in
   *
   * @remarks
   * Public. The provider redirects the browser here. Always answers with a 302 to the site: to `/` (or `/login/2fa` when a second factor is pending) after signing in, to `/register/social?token=...` when a new account must be completed with `POST /auth/social/complete`, or to `/login?error=<code>` with `oauth_state`, `oauth_failed`, `email_unverified`, `banned` or `account_not_activated`.
   * A verified email that matches exactly one active account links the provider to it. The state is single use.
   */
  @ApiParam({
    name: 'provider',
    description: 'Provider slug the flow was started with.',
  })
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, unknown>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const text = (value: unknown) =>
      typeof value === 'string' ? value : undefined;
    const { location, sessionId, pendingToken } = await this.social.callback(
      provider,
      {
        code: text(query.code),
        state: text(query.state),
        error: text(query.error),
        stateCookie: request.cookies[STATE_COOKIE],
        previousSessionId: request.auth?.sessionId ?? null,
      },
    );
    reply.clearCookie(STATE_COOKIE, { path: STATE_COOKIE_PATH });
    // Binds the signup continuation to this browser; `complete` requires it.
    if (pendingToken) this.setFlowCookie(reply, PENDING_COOKIE, pendingToken);
    if (sessionId) setSessionCookie(reply, sessionId, this.env.cookieSecure);
    reply.redirect(location, 302);
  }

  /**
   * Complete a social sign-up
   *
   * @remarks
   * Public. Creates the account for a pending social sign-in using the `token` from the callback redirect (valid 10 minutes, single use, and only from the browser that ran the callback, which holds the `oauth_pending` cookie). The account is active at once and the response signs it in like login.
   * Errors: 400 `invalid_token`, 400 `validation_failed` (taken username, password policy), 409 `conflict`, 429 `rate_limited` (shares the registration budget of 5 per IP per hour).
   */
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
      request.auth?.sessionId ?? null,
      request.cookies[PENDING_COOKIE],
    );
    reply.clearCookie(PENDING_COOKIE, { path: STATE_COOKIE_PATH });
    setSessionCookie(reply, sessionId, this.env.cookieSecure);
    return SessionResponse.from(user, principal, session);
  }

  private setFlowCookie(
    reply: FastifyReply,
    name: string,
    value: string,
  ): void {
    reply.setCookie(name, value, {
      httpOnly: true,
      secure: this.env.cookieSecure,
      sameSite: 'lax',
      path: STATE_COOKIE_PATH,
      maxAge: STATE_TTL_SECONDS,
    });
  }
}
