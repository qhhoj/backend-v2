import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  AppError,
  type Env,
  ENV,
  limiterAddress,
  RateLimitService,
} from '@libs/common';
import { uuidStr, type IntegrationScope } from '@libs/database';
import {
  BEFORE_TWO_FACTOR_ROUTE,
  NO_IMPERSONATION_ROUTE,
  PUBLIC_ROUTE,
  PWNED_PASSWORD_ROUTE,
  REQUIRED_PERMISSION,
  REQUIRED_SCOPE,
  SERVICE_ONLY_ROUTE,
  SESSION_ONLY_ROUTE,
  SUPERUSER_TOKEN_ROUTE,
} from '../decorators/auth.decorators';
import { constantTimeEqual, sha256 } from '../crypto';
import {
  type IntegrationClientDocument,
  IntegrationClientsRepository,
  isUsableClient,
} from '../integration/integration-clients.repository';
import { Permission } from '../principal/permissions';
import { hasPermission } from '../principal/principal';
import { PrincipalService } from '../principal/principal.service';
import { SESSION_COOKIE, setSessionCookie } from '../session/session-cookie';
import { COOKIE_REFRESH_MS, SessionService } from '../session/session.service';
import { apiTokenMatches, parseApiToken } from '../token/api-token';
import { matchesAnyCidr } from '../token/cidr';
import { isServiceKey, SERVICE_KEY_PREFIX } from '../token/service-key';
import { isActiveSuperuser } from '../users/active-superuser';
import { UsersRepository } from '../users/users.repository';
import { AuthContext } from './auth-context';

const isBearerHeader = (header: string) => /^bearer/i.test(header);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Failed integration-key lookups per address and window. */
const SERVICE_KEY_FAILURE_LIMIT = 20;
const SERVICE_KEY_FAILURE_WINDOW_SECONDS = 600;
/** Reads a decorator's value, the handler's overriding the controller's. */
type RouteMetadataReader = <Value>(key: string) => Value | undefined;

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly siteOrigin: string;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly users: UsersRepository,
    private readonly principals: PrincipalService,
    private readonly clients: IntegrationClientsRepository,
    private readonly rateLimit: RateLimitService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.siteOrigin = new URL(env.siteUrl).origin;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const readRouteMetadata: RouteMetadataReader = <Value>(key: string) =>
      this.reflector.getAllAndOverride<Value | undefined>(key, [
        context.getHandler(),
        context.getClass(),
      ]);
    if (readRouteMetadata<boolean>(SERVICE_ONLY_ROUTE))
      return this.authenticateServiceClient(request, readRouteMetadata);
    this.assertSameOrigin(request);
    await this.authenticateAndRefreshCookie(
      request,
      http.getResponse<FastifyReply>(),
    );
    if (readRouteMetadata<boolean>(PUBLIC_ROUTE)) return true;
    const { auth } = request;
    if (!auth) throw new AppError('unauthorized', 401, 'Login required');
    if (auth.viaToken) this.assertTokenAllowed(auth, readRouteMetadata);
    if (auth.session)
      this.assertSessionAllows(request, auth.session, readRouteMetadata);
    const permission = readRouteMetadata<Permission>(REQUIRED_PERMISSION);
    if (permission && !hasPermission(auth.principal, permission))
      throw new AppError('forbidden', 403, 'Permission denied');
    return true;
  }

  /**
   * A `@ServiceOnly()` route takes an integration client and no user credential. A session cookie or a non-`qhi_` bearer is a user (403, even a valid one: a user is never turned into a client); no credential, or a key that is malformed, unknown, revoked or expired, is 401. CSRF and the origin check do not apply: the scheme carries no cookie. The key is looked up on every request, so a revocation is immediate.
   */
  private async authenticateServiceClient(
    request: FastifyRequest,
    readRouteMetadata: RouteMetadataReader,
  ): Promise<boolean> {
    const header = request.headers.authorization ?? '';
    const token = /^bearer\s+(\S+)\s*$/i.exec(header)?.[1] ?? null;
    const isUserCredential =
      request.cookies[SESSION_COOKIE] !== undefined ||
      (header !== '' && !token?.startsWith(SERVICE_KEY_PREFIX));
    if (isUserCredential)
      throw new AppError(
        'forbidden',
        403,
        'This endpoint is for integration clients',
      );
    if (token === null)
      throw new AppError('unauthorized', 401, 'Integration key required');
    const client = await this.findServiceClient(token, request.ip);
    this.assertServiceClientMayCall(
      client,
      request.ip,
      readRouteMetadata<IntegrationScope>(REQUIRED_SCOPE),
    );
    request.serviceClient = {
      clientId: uuidStr(client._id),
      name: client.name,
      scopes: client.scopes,
      actsAs: uuidStr(client.actsAs),
    };
    await this.clients.touch(client._id, new Date()).catch(() => undefined);
    return true;
  }

  /**
   * Failed lookups are counted per address: the key is 256 bits, so this is about load, not guessing. Over the limit (20 in 10 minutes) the answer is 429 before the database is asked, for valid keys from that address too: whoever sends 20 junk keys locks out every client sharing its address for the window. Behind a proxy `request.ip` is the proxy unless `TRUST_PROXY` lists it, which would make that every client, so a deploy behind nginx must set `TRUST_PROXY` (the API warns at boot otherwise).
   */
  private async findServiceClient(
    token: string,
    address: string,
  ): Promise<IntegrationClientDocument> {
    const failures = `service-key-failures:ip:${limiterAddress(address)}`;
    if ((await this.rateLimit.count(failures)) >= SERVICE_KEY_FAILURE_LIMIT)
      throw new AppError(
        'rate_limited',
        429,
        'Too many invalid integration keys; try again later',
      );
    const client = await this.clientOfKey(token);
    if (!client || !isUsableClient(client, new Date())) {
      await this.rateLimit.hit(failures, SERVICE_KEY_FAILURE_WINDOW_SECONDS);
      throw new AppError('unauthorized', 401, 'Invalid integration key');
    }
    return client;
  }

  /** Only the sha256 of a key is stored; the stored hash is compared again in constant time after the indexed lookup. */
  private async clientOfKey(
    token: string,
  ): Promise<IntegrationClientDocument | null> {
    if (!isServiceKey(token)) return null;
    const hash = sha256(token);
    const client = await this.clients.findByKeyHash(hash);
    return client && constantTimeEqual(client.keyHash, hash) ? client : null;
  }

  private assertServiceClientMayCall(
    client: { allowedCidrs: string[]; scopes: readonly IntegrationScope[] },
    address: string,
    scope: IntegrationScope | undefined,
  ): void {
    if (!matchesAnyCidr(address, client.allowedCidrs))
      throw new AppError(
        'forbidden',
        403,
        'This address is not allowed for the key',
      );
    // A `@ServiceOnly()` route without `@RequireScope` serves nobody: a forgotten decorator must not open a write route to a read-only key.
    if (!scope || !client.scopes.includes(scope))
      throw new AppError(
        'forbidden',
        403,
        'The key lacks the scope for this endpoint',
      );
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

  /** A `@SessionOnly()` route refuses API tokens, except a superuser's on a route marked `@AllowSuperuserToken()`; superuser is read from the principal built from the user row. */
  private assertTokenAllowed(
    auth: AuthContext,
    readRouteMetadata: RouteMetadataReader,
  ): void {
    if (!readRouteMetadata<boolean>(SESSION_ONLY_ROUTE)) return;
    if (
      auth.principal.isSuperuser &&
      readRouteMetadata<boolean>(SUPERUSER_TOKEN_ROUTE)
    )
      return;
    throw new AppError(
      'forbidden',
      403,
      'This endpoint requires a browser session',
    );
  }

  /** Browser-session rules, in the order users meet them: CSRF token, second factor, breached password, impersonation. */
  private assertSessionAllows(
    request: FastifyRequest,
    session: NonNullable<AuthContext['session']>,
    readRouteMetadata: RouteMetadataReader,
  ): void {
    if (
      !SAFE_METHODS.has(request.method) &&
      !constantTimeEqual(request.headers['x-csrf-token'], session.csrf)
    )
      throw new AppError('csrf_failed', 403, 'Missing or invalid CSRF token');
    if (
      !session.twoFaPassed &&
      !readRouteMetadata<boolean>(BEFORE_TWO_FACTOR_ROUTE)
    )
      throw new AppError(
        'two_factor_required',
        403,
        'Two-factor authentication required',
      );
    if (
      session.passwordPwned &&
      !readRouteMetadata<boolean>(PWNED_PASSWORD_ROUTE)
    )
      throw new AppError(
        'password_change_required',
        403,
        'Your password appeared in a data breach; change it to continue',
      );
    if (
      session.impersonatorId &&
      readRouteMetadata<boolean>(NO_IMPERSONATION_ROUTE)
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
      ip: request.ip,
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
      ip: request.ip,
    };
  }
}
