import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { UsersRepository } from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import { AppError, ENV, REDIS } from '@libs/common';
import type { Env } from '@libs/common';
import Redis from 'ioredis';
import { AuthService } from './auth.service';
import type { SocialCompleteDto } from './dto/social-complete.dto';
import { RegistrationService } from './registration.service';
import { OAUTH_PROVIDERS } from './social/oauth-provider';
import type { OAuthProvider, SocialIdentity } from './social/oauth-provider';

const STATE_TTL_SECONDS = 600;
const MAX_STATE_LENGTH = 128;
const MONGO_DUPLICATE_KEY = 11000;
const LOGIN_REFUSALS = ['banned', 'account_not_activated'];
const randomToken = () => randomBytes(32).toString('base64url');

interface PendingLogin {
  provider: string;
  uid: string;
  email: string;
}

/** Where to send the browser; `sessionId` is set when the login succeeded. */
export interface CallbackResult {
  location: string;
  sessionId?: string;
}

export interface CallbackInput {
  code?: string;
  state?: string;
  error?: string;
  /** Value of the `oauth_state` cookie set by `start`. */
  stateCookie?: string;
}

const sameText = (left: string, right: string) =>
  left.length === right.length &&
  timingSafeEqual(Buffer.from(left), Buffer.from(right));

@Injectable()
export class SocialService {
  constructor(
    @Inject(OAUTH_PROVIDERS) private readonly providers: OAuthProvider[],
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The provider's authorization URL plus the state the browser must present again on the callback. */
  async start(slug: string): Promise<{ location: string; state: string }> {
    const provider = this.provider(slug);
    const state = randomToken();
    const codeVerifier = randomToken();
    await this.redis.set(
      `oauth-state:${state}`,
      JSON.stringify({ slug, codeVerifier }),
      'EX',
      STATE_TTL_SECONDS,
    );
    return {
      location: provider.authorizationUrl(
        state,
        codeVerifier,
        this.redirectUri(slug),
      ),
      state,
    };
  }

  async callback(
    slug: string,
    { code, state, error, stateCookie }: CallbackInput,
  ): Promise<CallbackResult> {
    const provider = this.provider(slug);
    // The state is consumed before anything else so every outcome, failed or not, spends it.
    const stored = await this.consumeState(state);
    if (
      !stored ||
      stored.slug !== slug ||
      !stateCookie ||
      !sameText(stateCookie, state!)
    )
      return this.loginError('oauth_state');
    if (error || !code) return this.loginError('oauth_failed');

    let identity: SocialIdentity;
    try {
      identity = await provider.fetchIdentity(
        code,
        stored.codeVerifier,
        this.redirectUri(slug),
      );
    } catch {
      return this.loginError('oauth_failed');
    }
    if (!identity.uid) return this.loginError('oauth_failed');

    try {
      return await this.resolve(provider, identity);
    } catch (caught) {
      if (caught instanceof AppError && LOGIN_REFUSALS.includes(caught.code))
        return this.loginError(caught.code);
      if ((caught as { code?: number }).code === MONGO_DUPLICATE_KEY)
        return this.loginError('oauth_failed');
      throw caught;
    }
  }

  async complete({ token, username, password }: SocialCompleteDto, ip: string) {
    const pending = await this.readPending(token);
    const created = await this.registration.withRegistrationSlot(
      pending.email,
      ip,
      async () => {
        const credentials = { username, email: pending.email, password };
        await this.registration.assertRegistrable(credentials);
        if (await this.users.findBySocial(pending.provider, pending.uid))
          throw this.invalidToken();
        // Single use: the token is only spent once the signup is known to succeed, and only one request can win it.
        if (!(await this.redis.getdel(`oauth-pending:${token}`)))
          throw this.invalidToken();
        return this.registration.createUser({
          ...credentials,
          isActive: true,
          socialAuth: [
            { provider: pending.provider, uid: pending.uid, extraData: {} },
          ],
        });
      },
    );
    return this.auth.startSession(created, false);
  }

  private async resolve(
    provider: OAuthProvider,
    { uid, email, emailVerified }: SocialIdentity,
  ): Promise<CallbackResult> {
    const linked = await this.users.findBySocial(provider.legacyName, uid);
    if (linked) return this.login(linked);
    if (!emailVerified || !email) return this.loginError('email_unverified');

    // Several matches are ambiguous: never guess, let registration reject the taken email.
    const [match, ...others] = await this.users.findActiveByEmail(email);
    if (
      match &&
      !others.length &&
      (await this.users.linkSocial(match._id, {
        provider: provider.legacyName,
        uid,
        extraData: {},
      }))
    )
      return this.login(match);

    const token = randomToken();
    const pending: PendingLogin = { provider: provider.legacyName, uid, email };
    await this.redis.set(
      `oauth-pending:${token}`,
      JSON.stringify(pending),
      'EX',
      STATE_TTL_SECONDS,
    );
    return { location: `${this.env.siteUrl}/register/social?token=${token}` };
  }

  private async login(user: UserDocument): Promise<CallbackResult> {
    const { sessionId, session } = await this.auth.startSession(user, false);
    return {
      sessionId,
      location: `${this.env.siteUrl}${session.twoFaPassed ? '/' : '/login/2fa'}`,
    };
  }

  private provider(slug: string): OAuthProvider {
    const provider = this.providers.find(
      (candidate) => candidate.slug === slug,
    );
    if (!provider) throw new AppError('not_found', 404, 'Unknown provider');
    return provider;
  }

  private redirectUri(slug: string): string {
    return `${this.env.siteUrl}/api/internal/auth/social/${slug}/callback`;
  }

  private loginError(code: string): CallbackResult {
    return { location: `${this.env.siteUrl}/login?error=${code}` };
  }

  private invalidToken(): AppError {
    return new AppError('invalid_token', 400, 'Token is invalid or expired');
  }

  private async consumeState(
    state: string | undefined,
  ): Promise<{ slug: string; codeVerifier: string } | null> {
    if (!state || state.length > MAX_STATE_LENGTH) return null;
    const stored = await this.redis.getdel(`oauth-state:${state}`);
    return stored
      ? (JSON.parse(stored) as { slug: string; codeVerifier: string })
      : null;
  }

  /** Read without consuming, so a rejected username or password leaves the token usable for a retry. */
  private async readPending(token: string): Promise<PendingLogin> {
    const stored = await this.redis.get(`oauth-pending:${token}`);
    if (!stored) throw this.invalidToken();
    return JSON.parse(stored) as PendingLogin;
  }
}
