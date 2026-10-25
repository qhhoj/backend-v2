import { Inject, Injectable } from '@nestjs/common';
import {
  constantTimeEqual,
  randomToken,
  unusablePasswordHash,
  UsersRepository,
} from '@libs/auth';
import type { UserDocument } from '@libs/auth';
import {
  AppError,
  ENV,
  isDuplicateKey,
  limiterAddress,
  MAIL_ADDRESS_PATTERN,
  RateLimitService,
  REDIS,
} from '@libs/common';
import type { Env } from '@libs/common';
import Redis from 'ioredis';
import { AuthService } from '../core/auth.service';
import type { SocialCompleteDto } from './dto/social-complete.dto';
import {
  OAUTH_START_LIMIT,
  OAUTH_START_WINDOW_SECONDS,
} from '../core/rate-limits';
import { RegistrationService } from '../registration/registration.service';
import { OAuthProvidersService } from './oauth-providers.service';
import type { OAuthProvider, SocialIdentity } from './oauth-provider';

/** Lifetime of OAuth state and pending signup, in Redis and in their browser cookies. */
export const STATE_TTL_SECONDS = 600;
const MAX_STATE_LENGTH = 128;
const LOGIN_REFUSALS = ['banned', 'account_not_activated', 'account_disabled'];
const invalidToken = () =>
  new AppError('invalid_token', 400, 'Token is invalid or expired');

interface PendingLogin {
  provider: string;
  uid: string;
  email: string;
}

/** Where to send the browser; `sessionId` is set when the login succeeded, `pendingToken` when signup must be completed. */
interface CallbackResult {
  location: string;
  sessionId?: string;
  pendingToken?: string;
}

interface CallbackInput {
  code?: string;
  state?: string;
  error?: string;
  /** Value of the `oauth_state` cookie set by `start`. */
  stateCookie?: string;
  /** Session of the requesting browser, replaced on a successful login. */
  previousSessionId: string | null;
}

@Injectable()
export class SocialService {
  constructor(
    private readonly providers: OAuthProvidersService,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
    private readonly registration: RegistrationService,
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  enabledProviders(): Array<OAuthProvider['slug']> {
    return this.providers.slugs();
  }

  /** The provider's authorization URL plus the state the browser must present again on the callback. */
  async start(
    slug: string,
    ip: string,
  ): Promise<{ location: string; state: string }> {
    const provider = this.provider(slug);
    // Never released; over the limit this throws the same 429 `rate_limited` as the other auth endpoints.
    await this.rateLimit.reserve(
      [`oauth-start:ip:${limiterAddress(ip)}`],
      OAUTH_START_LIMIT,
      OAUTH_START_WINDOW_SECONDS,
    );
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
    { code, state, error, stateCookie, previousSessionId }: CallbackInput,
  ): Promise<CallbackResult> {
    const provider = this.provider(slug);
    // The state is consumed before anything else so every outcome, failed or not, spends it.
    const stored = await this.consumeState(state);
    if (
      !state ||
      !stored ||
      stored.slug !== slug ||
      !stateCookie ||
      !constantTimeEqual(stateCookie, state)
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
      return await this.resolve(provider, identity, previousSessionId);
    } catch (caught) {
      if (caught instanceof AppError && LOGIN_REFUSALS.includes(caught.code))
        return this.loginError(caught.code);
      if (isDuplicateKey(caught)) return this.loginError('oauth_failed');
      throw caught;
    }
  }

  async complete(
    {
      token,
      username,
      password,
      organizationId,
      languageId,
    }: SocialCompleteDto,
    ip: string,
    previousSessionId: string | null,
    pendingCookie: string | undefined,
  ) {
    // Binds the continuation to the browser that ran the callback; checked before the token is read or spent.
    if (!constantTimeEqual(pendingCookie, token)) throw invalidToken();
    const pending = await this.readPending(token);
    const created = await this.registration.withRegistrationSlot(
      pending.email,
      ip,
      async () => {
        const credentials = {
          username,
          email: pending.email,
          password,
          organizationId,
          languageId,
        };
        await this.registration.assertRegistrable(credentials);
        if (await this.users.findBySocial(pending.provider, pending.uid))
          throw invalidToken();
        // Single use: the token is only spent once the signup is known to succeed, and only one request can win it.
        if (!(await this.redis.getdel(`oauth-pending:${token}`)))
          throw invalidToken();
        return this.registration.createUser(
          {
            username,
            email: pending.email,
            password,
            ...(await this.registration.profileFields(credentials)),
            isActive: true,
            socialAuth: [
              { provider: pending.provider, uid: pending.uid, extraData: {} },
            ],
          },
          ip,
        );
      },
    );
    await this.registration.announceMembership(created);
    return this.auth.startSession(created, {
      isPasswordPwned: false,
      previousSessionId,
    });
  }

  private async resolve(
    provider: OAuthProvider,
    { uid, email, emailVerified }: SocialIdentity,
    previousSessionId: string | null,
  ): Promise<CallbackResult> {
    const linked = await this.users.findBySocial(provider.legacyName, uid);
    if (linked) return this.login(linked, previousSessionId);
    const usableEmail =
      email && MAIL_ADDRESS_PATTERN.test(email) ? email : null;
    if (!emailVerified || !usableEmail)
      return this.loginError('email_unverified');

    // Several matches are ambiguous: never guess, let registration reject the taken email.
    const [match, ...others] = await this.users.findActiveByEmail(usableEmail);
    if (match && !others.length && (await this.autoLink(match, provider, uid)))
      return this.login(match, previousSessionId);

    const token = randomToken();
    const pending: PendingLogin = {
      provider: provider.legacyName,
      uid,
      email: usableEmail,
    };
    await this.redis.set(
      `oauth-pending:${token}`,
      JSON.stringify(pending),
      'EX',
      STATE_TTL_SECONDS,
    );
    return {
      location: `${this.env.siteUrl}/register/social?token=${token}`,
      pendingToken: token,
    };
  }

  /** Ends the account's earlier credentials before the link is saved, so a failure in between leaves no link that would skip this on the next sign-in. False when the account already has a link for this provider. */
  private async autoLink(
    user: UserDocument,
    provider: OAuthProvider,
    uid: string,
  ): Promise<boolean> {
    if (user.socialAuth.some((link) => link.provider === provider.legacyName))
      return false;
    await this.endEarlierCredentials(user);
    return this.users.linkSocial(user._id, {
      provider: provider.legacyName,
      uid,
      extraData: {},
    });
  }

  /** An auto-linked account may have been registered by someone else with this address: its other sessions and API token always end; one never signed in to also loses its password until one is set with the reset form. */
  private async endEarlierCredentials(user: UserDocument): Promise<void> {
    if (user.lastLogin === null)
      await this.users.update(user._id, { password: unusablePasswordHash() });
    await this.auth.logoutAll(user._id);
  }

  private async login(
    user: UserDocument,
    previousSessionId: string | null,
  ): Promise<CallbackResult> {
    this.auth.assertLoginAllowed(user);
    const { sessionId, session } = await this.auth.startSession(user, {
      isPasswordPwned: false,
      previousSessionId,
    });
    return {
      sessionId,
      location: `${this.env.siteUrl}${session.twoFaPassed ? '/' : '/login/2fa'}`,
    };
  }

  private provider(slug: string): OAuthProvider {
    const provider = this.providers.find(slug);
    if (!provider) throw new AppError('not_found', 404, 'Unknown provider');
    return provider;
  }

  private redirectUri(slug: string): string {
    return `${this.env.siteUrl}/api/internal/auth/social/${slug}/callback`;
  }

  private loginError(code: string): CallbackResult {
    return { location: `${this.env.siteUrl}/login?error=${code}` };
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
    if (!stored) throw invalidToken();
    return JSON.parse(stored) as PendingLogin;
  }
}
