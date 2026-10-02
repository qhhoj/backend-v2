import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { AppError, ENV, type Env } from '@libs/common';
import {
  PARTIAL_AUTH_ROUTE,
  PUBLIC_ROUTE,
  PWNED_PASSWORD_ROUTE,
  REQUIRED_PERMISSION,
  SESSION_ONLY_ROUTE,
} from '../decorators/auth.decorators';
import { Permission } from '../principal/permissions';
import { hasPermission } from '../principal/principal';
import { PrincipalService } from '../principal/principal.service';
import { SESSION_COOKIE, setSessionCookie } from '../session/session-cookie';
import { COOKIE_REFRESH_MS, SessionService } from '../session/session.service';
import { apiTokenMatches, parseApiToken } from '../token/api-token';
import { UsersRepository } from '../users/users.repository';
import { AuthContext } from './auth-context';

const isBearerHeader = (header: string) => /^bearer/i.test(header);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const sameToken = (given: unknown, expected: string) => {
  if (typeof given !== 'string') return false;
  const givenBytes = Buffer.from(given);
  const expectedBytes = Buffer.from(expected);
  return (
    givenBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(givenBytes, expectedBytes)
  );
};

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly siteOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
    private readonly principals: PrincipalService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.siteOrigin = new URL(env.siteUrl).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const routeFlag = <T>(key: string) =>
      this.reflector.getAllAndOverride<T | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]);
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { origin } = request.headers;
    if (
      !SAFE_METHODS.has(request.method) &&
      !isBearerHeader(request.headers.authorization ?? '') &&
      origin !== undefined &&
      origin !== this.siteOrigin
    )
      throw new AppError('csrf_failed', 403, 'Cross-origin request rejected');
    request.auth =
      (await this.fromBearer(request)) ??
      (await this.fromSession(request)) ??
      undefined;
    await this.refreshCookie(
      context.switchToHttp().getResponse<FastifyReply>(),
      request.auth,
    );
    if (routeFlag<boolean>(PUBLIC_ROUTE)) return true;

    const { auth } = request;
    if (!auth) throw new AppError('unauthorized', 401, 'Login required');
    if (auth.viaToken && routeFlag<boolean>(SESSION_ONLY_ROUTE))
      throw new AppError(
        'forbidden',
        403,
        'This endpoint requires a browser session',
      );
    const { session } = auth;
    if (
      session &&
      !SAFE_METHODS.has(request.method) &&
      !sameToken(request.headers['x-csrf-token'], session.csrf)
    )
      throw new AppError('csrf_failed', 403, 'Missing or invalid CSRF token');
    if (
      session &&
      !session.twoFaPassed &&
      !routeFlag<boolean>(PARTIAL_AUTH_ROUTE)
    )
      throw new AppError(
        'two_factor_required',
        403,
        'Two-factor authentication required',
      );
    if (session?.passwordPwned && !routeFlag<boolean>(PWNED_PASSWORD_ROUTE))
      throw new AppError(
        'password_change_required',
        403,
        'Your password appeared in a data breach; change it to continue',
      );
    const permission = routeFlag<Permission>(REQUIRED_PERMISSION);
    if (permission && !hasPermission(auth.principal, permission))
      throw new AppError('forbidden', 403, 'Permission denied');
    return true;
  }

  private async refreshCookie(
    reply: FastifyReply,
    auth: AuthContext | undefined,
  ) {
    if (
      !auth?.sessionId ||
      !auth.session ||
      Date.now() - auth.session.cookieIssuedAt <= COOKIE_REFRESH_MS
    )
      return;
    setSessionCookie(reply, auth.sessionId, this.env.cookieSecure);
    await this.sessions.update(auth.sessionId, { cookieIssuedAt: Date.now() });
  }

  private async fromBearer(
    request: FastifyRequest,
  ): Promise<AuthContext | null> {
    const header = request.headers.authorization ?? '';
    if (!isBearerHeader(header)) return null;
    const token = /^bearer\s+(\S+)\s*$/i.exec(header)?.[1];
    const parsed = token ? parseApiToken(token) : null;
    const user = parsed && (await this.users.findById(parsed.userId));
    if (
      !parsed ||
      !user?.isActive ||
      !apiTokenMatches(parsed.secret, user.apiTokenHash, this.env.tokenSecret)
    )
      throw new AppError('unauthorized', 401, 'Invalid API token');
    return {
      user,
      principal: this.principals.build(user),
      sessionId: null,
      session: null,
      viaToken: true,
    };
  }

  private async fromSession(
    request: FastifyRequest,
  ): Promise<AuthContext | null> {
    const sessionId = request.cookies[SESSION_COOKIE];
    const session = sessionId ? await this.sessions.get(sessionId) : null;
    const user = session && (await this.users.findById(session.userId));
    if (!sessionId || !session || !user?.isActive) return null;
    return {
      user,
      principal: this.principals.build(user),
      sessionId,
      session,
      viaToken: false,
    };
  }
}
