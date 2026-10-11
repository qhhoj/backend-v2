import { getQueueToken } from '@nestjs/bullmq';
import { REDIS } from '@libs/common';
import { ORGANIZATION_POINTS_QUEUE } from '@libs/community';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { RegistrationService } from '../src/modules/auth/registration/registration.service';
import { OAuthProvidersService } from '../src/modules/auth/social/oauth-providers.service';
import {
  OAuthProvider,
  SocialIdentity,
} from '../src/modules/auth/social/oauth-provider';
import {
  ApiTest,
  createUser,
  errorCode,
  sessionCookie,
  setupApiTest,
} from './setup';

const SOCIAL = '/api/internal/auth/social';
const SITE = 'http://localhost:5173';
const PASSWORD = 'correct horse battery';

class FakeOAuthProvider implements OAuthProvider {
  readonly identities = new Map<string, SocialIdentity>();
  constructor(
    readonly slug: 'github' | 'google',
    readonly legacyName: string,
  ) {}
  authorizationUrl(state: string) {
    return `https://provider.test/authorize?state=${state}`;
  }
  fetchIdentity(code: string) {
    const identity = this.identities.get(code);
    return identity
      ? Promise.resolve(identity)
      : Promise.reject(new Error('provider rejected the code'));
  }
}

const github = new FakeOAuthProvider('github', 'github-secure');
const google = new FakeOAuthProvider('google', 'google-oauth2');

/** Stands in for the settings-driven service: `all` is the set of enabled providers. */
class FakeProviders {
  all: FakeOAuthProvider[] = [github, google];
  find = (slug: string) => this.all.find((provider) => provider.slug === slug);
  slugs = () => this.all.map((provider) => provider.slug);
}
const providers = new FakeProviders();

const cookiesOf = (headers: Record<string, unknown>) =>
  (headers['set-cookie'] as string[] | undefined) ?? [];
const cookieValue = (headers: Record<string, unknown>, name: string) =>
  new RegExp(`${name}=([^;]*)`).exec(cookiesOf(headers).join('\n'))?.[1];

describe('social login', () => {
  let api: ApiTest;
  let queue: Queue<{ organizationId: string }>;
  let redis: Redis;

  /** Runs `start` and returns the state with the cookie header a browser would send back. */
  const start = async (slug = 'github') => {
    const response = await api.http().get(`${SOCIAL}/${slug}/start`);
    const state = cookieValue(response.headers, 'oauth_state')!;
    return { response, state, cookie: `oauth_state=${state}` };
  };
  const callback = (
    state: string,
    { code = 'code-1', cookie = `oauth_state=${state}`, slug = 'github' } = {},
  ) =>
    api
      .http()
      .get(`${SOCIAL}/${slug}/callback`)
      .query({ code, state })
      .set('Cookie', cookie);
  /** A full login round trip for `code`. */
  const login = async (code: string) =>
    callback((await start()).state, { code });
  const pendingToken = (location: string) =>
    new URL(location).searchParams.get('token')!;
  /** `complete` as the browser that ran the callback: it sends the `oauth_pending` cookie holding the token. */
  const complete = (
    body: Record<string, unknown>,
    cookie = `oauth_pending=${body.token as string}`,
  ) => api.http().post(`${SOCIAL}/complete`).set('Cookie', cookie).send(body);
  const linkOf = (provider: string, uid: string) => ({
    socialAuth: [{ provider, uid, extraData: {} }],
  });

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [{ provide: OAuthProvidersService, useValue: providers }],
    });
    redis = api.app.get<Redis>(REDIS);
    queue = api.app.get(getQueueToken(ORGANIZATION_POINTS_QUEUE));
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await api.users.deleteMany({});
    await queue.drain();
    const pending = await redis.keys('organization-points:pending:*');
    if (pending.length) await redis.del(...pending);
    github.identities.clear();
    google.identities.clear();
    const keys = await redis.keys('rate:*');
    if (keys.length) await redis.del(...keys);
  });

  it('a wrong state is rejected and the right state is single-use', async () => {
    const { state, cookie } = await start();
    const wrong = await callback('wrong-state');
    expect(wrong.status).toBe(302);
    expect(wrong.headers.location).toBe(`${SITE}/login?error=oauth_state`);
    github.identities.set('code-1', {
      uid: 'g-1',
      email: null,
      emailVerified: false,
    });
    expect((await callback(state, { cookie })).headers.location).toBe(
      `${SITE}/login?error=email_unverified`,
    );
    expect((await callback(state, { cookie })).headers.location).toBe(
      `${SITE}/login?error=oauth_state`,
    );
  });

  it('logs in a user with an existing link and the session works', async () => {
    await createUser(api.users, linkOf('github-secure', 'g-1'));
    github.identities.set('code-1', {
      uid: 'g-1',
      email: null,
      emailVerified: false,
    });
    const response = await login('code-1');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${SITE}/`);
    const cookie = cookieValue(response.headers, 'qhhoj_session')!;
    await api
      .http()
      .get('/api/internal/auth/me')
      .set('Cookie', sessionCookie(cookie))
      .expect(200)
      .expect(({ body }) =>
        expect(
          (body as { data: { user: { username: string } } }).data.user.username,
        ).toBe('alice'),
      );
    expect((await api.users.findOne())!.lastLogin).not.toBeNull();
  });

  it('links a verified email of exactly one active user and logs in', async () => {
    await createUser(api.users, {});
    github.identities.set('code-1', {
      uid: 'g-9',
      email: 'ALICE@example.com',
      emailVerified: true,
    });
    const response = await login('code-1');
    expect(response.headers.location).toBe(`${SITE}/`);
    expect(cookieValue(response.headers, 'qhhoj_session')).toBeTruthy();
    const user = (await api.users.findOne())!;
    expect(user.socialAuth.map(({ provider, uid }) => [provider, uid])).toEqual(
      [['github-secure', 'g-9']],
    );
  });

  it('does not link by an unverified email', async () => {
    await createUser(api.users, {});
    github.identities.set('code-1', {
      uid: 'g-9',
      email: 'alice@example.com',
      emailVerified: false,
    });
    const response = await login('code-1');
    expect(response.headers.location).toBe(
      `${SITE}/login?error=email_unverified`,
    );
    expect(cookieValue(response.headers, 'qhhoj_session')).toBeUndefined();
    expect((await api.users.findOne())!.socialAuth).toHaveLength(0);
  });

  it('does not link inactive users or ambiguous matches, and sends them to registration', async () => {
    await createUser(api.users, { username: 'one', isActive: false });
    await createUser(api.users, { username: 'two', email: 'dup@example.com' });
    await createUser(api.users, {
      username: 'three',
      email: 'dup@example.com',
    });
    for (const email of ['alice@example.com', 'dup@example.com']) {
      github.identities.set('code-1', {
        uid: 'g-9',
        email,
        emailVerified: true,
      });
      const response = await login('code-1');
      expect(response.headers.location).toMatch(
        new RegExp(`^${SITE}/register/social\\?token=`),
      );
    }
    expect(
      await api.users.countDocuments({ 'socialAuth.0': { $exists: true } }),
    ).toBe(0);
  });

  it('registers an unknown verified identity through complete, once', async () => {
    github.identities.set('code-1', {
      uid: 'g-2',
      email: 'new@example.com',
      emailVerified: true,
    });
    const response = await login('code-1');
    expect(response.headers.location).toMatch(
      new RegExp(`^${SITE}/register/social\\?token=`),
    );
    expect(cookieValue(response.headers, 'qhhoj_session')).toBeUndefined();
    const token = pendingToken(response.headers.location);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(await redis.ttl(`oauth-pending:${token}`)).toBeGreaterThan(590);

    const completed = await complete({
      token,
      username: 'socialite',
      password: PASSWORD,
    }).expect(200);
    const body = completed.body as {
      data: {
        user: { username: string; email: string };
        twoFactorRequired: boolean;
      };
    };
    expect(body.data.user).toMatchObject({
      username: 'socialite',
      email: 'new@example.com',
    });
    expect(body.data.twoFactorRequired).toBe(false);
    const cookie = cookieValue(completed.headers, 'qhhoj_session')!;
    await api
      .http()
      .get('/api/internal/auth/me')
      .set('Cookie', sessionCookie(cookie))
      .expect(200);
    const user = (await api.users.findOne({ username: 'socialite' }))!;
    expect(user.isActive).toBe(true);
    expect(user.lastLogin).not.toBeNull();
    expect(
      user.socialAuth.map(({ provider, uid, extraData }) => [
        provider,
        uid,
        extraData,
      ]),
    ).toEqual([['github-secure', 'g-2', {}]]);
    await complete({ token, username: 'socialite2', password: PASSWORD })
      .expect(400)
      .expect(errorCode('invalid_token'));
  });

  it('stores the chosen language and school on a social signup and refuses a closed school', async () => {
    const language = await api.languages.create({
      key: 'PY3',
      name: 'Python 3',
      commonName: 'Python',
      ace: 'python',
      pygments: 'python3',
      extension: 'py',
    });
    const [open, closed] = await api.organizations.create(
      [true, false].map((isOpen) => ({
        slug: isOpen ? 'open' : 'closed',
        shortName: isOpen ? 'OPEN' : 'CLOSED',
        name: 'School',
        about: '',
        aboutHtml: '',
        isOpen,
        isUnlisted: false,
      })),
    );
    github.identities.set('code-1', {
      uid: 'g-2',
      email: 'new@example.com',
      emailVerified: true,
    });
    const token = pendingToken((await login('code-1')).headers.location);
    const body = { token, username: 'socialite', password: PASSWORD };
    await complete({ ...body, organizationId: closed._id })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await complete({
      ...body,
      organizationId: open._id,
      languageId: language._id,
    }).expect(200);
    const user = (await api.users.findOne({ username: 'socialite' }).lean())!;
    expect(user.languageId?.toString()).toBe(language._id);
    expect(user.organizations.map(String)).toEqual([open._id]);
    expect(
      (await queue.getJobs(['waiting'])).map((job) => job.data.organizationId),
    ).toEqual([open._id]);
  });

  it('binds the pending token to the browser through the oauth_pending cookie', async () => {
    github.identities.set('code-1', {
      uid: 'g-2',
      email: 'new@example.com',
      emailVerified: true,
    });
    const response = await login('code-1');
    const token = pendingToken(response.headers.location);
    expect(cookieValue(response.headers, 'oauth_pending')).toBe(token);
    const cookie = cookiesOf(response.headers).find((header) =>
      header.startsWith('oauth_pending='),
    )!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/internal/auth/social');
    expect(cookie).toContain('Max-Age=600');
    expect(cookie).not.toContain('Secure');

    const body = { token, username: 'socialite', password: PASSWORD };
    await api
      .http()
      .post(`${SOCIAL}/complete`)
      .send(body)
      .expect(400)
      .expect(errorCode('invalid_token'));
    await complete(body, 'oauth_pending=someone-else')
      .expect(400)
      .expect(errorCode('invalid_token'));
    expect(await redis.exists(`oauth-pending:${token}`)).toBe(1);

    const completed = await complete(body).expect(200);
    expect(cookiesOf(completed.headers).join('\n')).toMatch(
      /oauth_pending=;.*Path=\/api\/internal\/auth\/social/,
    );
  });

  it('sends a 2FA-enabled user to the second step with an unfinished session', async () => {
    await createUser(api.users, {
      ...linkOf('github-secure', 'g-1'),
      isTotpEnabled: true,
    });
    github.identities.set('code-1', {
      uid: 'g-1',
      email: null,
      emailVerified: false,
    });
    const response = await login('code-1');
    expect(response.headers.location).toBe(`${SITE}/login/2fa`);
    const cookie = cookieValue(response.headers, 'qhhoj_session')!;
    await api
      .http()
      .get('/api/internal/auth/me')
      .set('Cookie', sessionCookie(cookie))
      .expect(200)
      .expect(({ body }) =>
        expect(
          (body as { data: { twoFactorRequired: boolean } }).data
            .twoFactorRequired,
        ).toBe(true),
      );
    expect((await api.users.findOne())!.lastLogin).toBeNull();
  });

  describe('replaces the requesting browser session', () => {
    const me = (cookie: string) =>
      api.http().get('/api/internal/auth/me').set('Cookie', cookie);
    const oldSession = async () => {
      const user = await createUser(api.users, {
        username: 'old',
        email: 'old@example.com',
      });
      const { id } = await api.sessions.create({
        userId: user._id,
        twoFaPassed: true,
        passwordPwned: false,
        impersonatorId: null,
      });
      await me(sessionCookie(id)).expect(200);
      return sessionCookie(id);
    };

    it('on the callback', async () => {
      const previous = await oldSession();
      await createUser(api.users, linkOf('github-secure', 'g-1'));
      github.identities.set('code-1', {
        uid: 'g-1',
        email: null,
        emailVerified: false,
      });
      const { state } = await start();
      const response = await callback(state, {
        cookie: `oauth_state=${state}; ${previous}`,
      });
      expect(response.headers.location).toBe(`${SITE}/`);
      await me(previous).expect(401);
      await me(
        sessionCookie(cookieValue(response.headers, 'qhhoj_session')!),
      ).expect(200);
    });

    it('on complete', async () => {
      const previous = await oldSession();
      github.identities.set('code-1', {
        uid: 'g-2',
        email: 'new@example.com',
        emailVerified: true,
      });
      const token = pendingToken((await login('code-1')).headers.location);
      const completed = await complete(
        { token, username: 'socialite', password: PASSWORD },
        `oauth_pending=${token}; ${previous}`,
      ).expect(200);
      await me(previous).expect(401);
      await me(
        sessionCookie(cookieValue(completed.headers, 'qhhoj_session')!),
      ).expect(200);
    });

    it('is kept when the login is refused', async () => {
      const previous = await oldSession();
      await createUser(api.users, {
        ...linkOf('github-secure', 'g-1'),
        username: 'banned',
        email: 'b@example.com',
        isActive: false,
        banReason: 'spam',
      });
      github.identities.set('code-1', {
        uid: 'g-1',
        email: null,
        emailVerified: false,
      });
      const { state } = await start();
      await callback(state, { cookie: `oauth_state=${state}; ${previous}` });
      await me(previous).expect(200);
    });
  });

  it('maps a social account linked meanwhile to a conflict, not a taken username', async () => {
    github.identities.set('code-1', {
      uid: 'g-2',
      email: 'new@example.com',
      emailVerified: true,
    });
    const token = pendingToken((await login('code-1')).headers.location);
    await api.users.syncIndexes();
    // Bypasses the up-front findBySocial check to hit the unique index directly.
    const registration = api.app.get(RegistrationService);
    await registration.createUser({
      username: 'first',
      email: 'x@example.com',
      password: PASSWORD,
      socialAuth: [{ provider: 'github-secure', uid: 'g-2', extraData: {} }],
    });
    await expect(
      registration.createUser({
        username: 'second',
        email: 'y@example.com',
        password: PASSWORD,
        socialAuth: [{ provider: 'github-secure', uid: 'g-2', extraData: {} }],
      }),
    ).rejects.toMatchObject({ code: 'conflict', status: 409 });
    await complete({ token, username: 'third', password: PASSWORD })
      .expect(400)
      .expect(errorCode('invalid_token'));
  });
});
