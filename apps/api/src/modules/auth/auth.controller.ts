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
  AllowPartialAuth,
  AllowPwnedPassword,
  clearSessionCookie,
  CurrentAuth,
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
import { LoginDto } from './dto/login.dto';
import { SessionResponse } from './dto/session.response';

@Controller('api/internal/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

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
    );
    if (request.auth?.sessionId)
      await this.sessions.destroy(request.auth.sessionId);
    setSessionCookie(reply, sessionId, this.env.cookieSecure);
    return SessionResponse.from(user, principal, session);
  }

  @AllowPartialAuth()
  @AllowPwnedPassword()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext): SessionResponse {
    return SessionResponse.from(auth.user, auth.principal, auth.session);
  }

  @AllowPartialAuth()
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

  @SessionOnly()
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessions.destroyAllForUser(auth.principal.userId);
    clearSessionCookie(reply);
  }

  @SessionOnly()
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

  @SessionOnly()
  @Post('token/regenerate')
  regenerateToken(
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ token: string }> {
    return this.auth.regenerateApiToken(auth.principal.userId);
  }
}
