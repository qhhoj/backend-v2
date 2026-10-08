import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ENV, type Env } from '@libs/common';
import {
  BEFORE_TWO_FACTOR_ROUTE,
  NO_IMPERSONATION_ROUTE,
  PUBLIC_ROUTE,
  PWNED_PASSWORD_ROUTE,
  REQUIRED_PERMISSION,
  SESSION_ONLY_ROUTE,
} from '../decorators/auth.decorators';
import { constantTimeEqual } from '../crypto';
import { Permission } from '../principal/permissions';
import { hasPermission } from '../principal/principal';
import { PrincipalService } from '../principal/principal.service';
import { SESSION_COOKIE, setSessionCookie } from '../session/session-cookie';
import { COOKIE_REFRESH_MS, SessionService } from '../session/session.service';
import { apiTokenMatches, parseApiToken } from '../token/api-token';
import { isActiveSuperuser } from '../users/active-superuser';
import { UsersRepository } from '../users/users.repository';
import { AuthContext } from './auth-context';

const isBearerHeader = (header: string) => /^bearer/i.test(header);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Reads a decorator's value, the handler's overriding the controller's. */
type RouteMetadata = <Value>(key: string) => Value | undefined;

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
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    this.assertSameOrigin(request);
    await this.authenticateAndRefreshCookie(
      request,
      http.getResponse<FastifyReply>(),
    );
    const routeMetadata: RouteMetadata = <Value>(key: string) =>
      this.reflector.getAllAndOverride<Value | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]);
    if (routeMetadata<boolean>(PUBLIC_ROUTE)) return true;
    const { auth } = request;
    if (!auth) throw new AppError('unauthorized', 401, 'Login required');
    if (auth.viaToken && routeMetadata<boolean>(SESSION_ONLY_ROUTE))
      throw new AppError(
        'forbidden',
        403,
        'This endpoint requires a browser session',
      );
    if (auth.session)
      this.assertSessionAllows(request, auth.session, routeMetadata);
    const permission = routeMetadata<Permission>(REQUIRED_PERMISSION);
    if (permission && !hasPermission(auth.principal, permission))
      throw new AppError('forbidden', 403, 'Permission denied');
    return true;
  }

  /** Cookie requests from another origin are refused before anything else, public routes included; bearer clients send no cookies, so CSRF cannot reach them. */
  private assertSameOrigin(request: FastifyRequest): void {
    const { origin } = request.headers;
    if (
      !SAFE_METHODS.has(request.method) &&
      !isBearerHeader(request.headers.authorization ?? '') &&
      origin !== undefined &&
      origin !== this.siteOrigin
    )
      throw new AppError('csrf_failed', 403, 'Cross-origin request rejected');
  }

  /** Sets `request.auth` before the cookie refresh, so a failed refresh still leaves the request attributed. */
  private async authenticateAndRefreshCookie(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    request.auth =
      (await this.fromBearer(request)) ??
      (await this.fromSession(request)) ??
      undefined;
    await this.refreshCookie(reply, request.auth);
  }

  /** Browser-session rules, in the order users meet them: CSRF token, second factor, breached password, impersonation. */
  private assertSessionAllows(
    request: FastifyRequest,
    session: NonNullable<AuthContext['session']>,
    routeMetadata: RouteMetadata,
  ): void {
    if (
      !SAFE_METHODS.has(request.method) &&
      !constantTimeEqual(request.headers['x-csrf-token'], session.csrf)
    )
      throw new AppError('csrf_failed', 403, 'Missing or invalid CSRF token');
    if (
      !session.twoFaPassed &&
      !routeMetadata<boolean>(BEFORE_TWO_FACTOR_ROUTE)
    )
      throw new AppError(
        'two_factor_required',
        403,
        'Two-factor authentication required',
      );
    if (session.passwordPwned && !routeMetadata<boolean>(PWNED_PASSWORD_ROUTE))
      throw new AppError(
        'password_change_required',
        403,
        'Your password appeared in a data breach; change it to continue',
      );
    if (
      session.impersonatorId &&
      routeMetadata<boolean>(NO_IMPERSONATION_ROUTE)
    )
      throw new AppError('forbidden', 403, 'Not allowed while impersonating');
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

  /** An impersonation ends as soon as the impersonator stops being an active superuser. */
  private async impersonatorValid(impersonatorId: string) {
    return isActiveSuperuser(await this.users.findById(impersonatorId));
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
    if (!sessionId || !session) return null;
    if (
      !user?.isActive ||
      (session.impersonatorId &&
        !(await this.impersonatorValid(session.impersonatorId)))
    ) {
      await this.sessions.destroy(sessionId);
      return null;
    }
    return {
      user,
      principal: this.principals.build(user),
      sessionId,
      session,
      viaToken: false,
    };
  }
}
