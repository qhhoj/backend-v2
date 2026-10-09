import { Logger } from '@nestjs/common';
import { generateApiToken, sha256 } from '@libs/auth';
import type { Contest, User } from '@libs/database';
import { FeedAuthService } from '../src/modules/contests/feed/feed-auth.service';
import type {
  FeedKeyStatusResponse,
  MintedFeedKeyResponse,
} from '../src/modules/contests/feed/dto/feed-key.dto';
import {
  clearRateLimits,
  contestUrl,
  createContest,
  hoursFromNow,
} from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, sessionCookie, setupApiTest, TEST_ENV } from './setup';
import type { ApiTest } from './setup';

const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
const IP = '203.0.113.9';

// The CommonJS module object is mutable; the ES namespace import is not.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment
const nodeCrypto: typeof import('node:crypto') = require('node:crypto');

describe('feed keys and feed authorisation', () => {
  let api: ApiTest;
  let auth: FeedAuthService;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const url = (contest: Contest, suffix = '') =>
    contestUrl(contest.key, `/feed-key${suffix}`);
  const newContest = () => createContest(api, { authors: [users.editor._id] });
  /** Started two hours ago, ends in one, frozen for the last 90 minutes: frozen now. */
  const frozenContest = () =>
    createContest(api, {
      authors: [users.editor._id],
      formatName: 'icpc',
      startTime: hoursFromNow(-2),
      endTime: hoursFromNow(1),
      frozenLastMinutes: 90,
    });
  const mint = async (contest: Contest, body: object = {}) =>
    dataOf<MintedFeedKeyResponse>(
      await authed(
        api.http().post(url(contest)).send(body),
        sessions.editor,
      ).expect(201),
    );
  const attempt = (
    contest: Contest,
    header: string | undefined,
    now = new Date(),
  ) => auth.authorize({ authorization: header, ip: IP }, contest.key, now);

  beforeAll(async () => {
    api = await setupApiTest();
    auth = api.app.get(FeedAuthService);
    const roles: Array<[string, Partial<User>]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['admin', { isSuperuser: true, isStaff: true }],
      ['plain', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearRateLimits(api));

  it('mints a key once, stores only its sha256 and reports a status without the secret', async () => {
    const contest = await newContest();
    const minted = await mint(contest);
    expect(minted).toMatchObject({
      username: 'feed',
      mode: 'frozen-until-release',
    });
    expect(minted.key).toMatch(/^qhf_/);
    const stored = (await api.feedKeys
      .findOne({ contest: contest._id })
      .lean())!;
    expect(stored.keyHash).toBe(sha256(minted.key));
    expect(JSON.stringify(stored)).not.toContain(minted.key);
    const status = dataOf<FeedKeyStatusResponse>(
      await authed(api.http().get(url(contest)), sessions.editor).expect(200),
    );
    expect(status).toMatchObject({
      isActive: true,
      mode: 'frozen-until-release',
      releasedAt: null,
    });
    expect(JSON.stringify(status)).not.toContain(minted.key);
    expect(new Date(minted.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      13 * 86_400_000,
    );
  });

  it('honours the mode and expiry asked for, and refuses an unknown mode or a 31-day expiry', async () => {
    const contest = await newContest();
    const live = await mint(contest, { mode: 'live', expiresInDays: 2 });
    expect(live.mode).toBe('live');
    expect(new Date(live.expiresAt).getTime() - Date.now()).toBeLessThan(
      2 * 86_400_000,
    );
    await authed(
      api.http().post(url(contest)).send({ mode: 'always' }),
      sessions.editor,
    ).expect(400);
    await authed(
      api.http().post(url(contest)).send({ expiresInDays: 31 }),
      sessions.editor,
    ).expect(400);
  });

  it('accepts the key through Basic auth, and a newer key replaces the older one', async () => {
    const contest = await newContest();
    const first = await mint(contest);
    const accepted = await attempt(contest, basic('feed', first.key));
    expect(accepted.contest.key).toBe(contest.key);
    expect(accepted.feedKey.mode).toBe('frozen-until-release');
    const second = await mint(contest);
    await expect(
      attempt(contest, basic('feed', first.key)),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      attempt(contest, basic('feed', second.key)),
    ).resolves.toBeDefined();
  });

  it('opens one contest only: the key of one contest is refused on another', async () => {
    const [first, second] = [await newContest(), await newContest()];
    const { key } = await mint(first);
    await mint(second);
    await expect(attempt(second, basic('feed', key))).rejects.toMatchObject({
      status: 401,
    });
    await expect(attempt(first, basic('feed', key))).resolves.toBeDefined();
  });

  it('compares the key hash with the constant-time primitive, for right and wrong keys alike', async () => {
    const contest = await newContest();
    const { key } = await mint(contest);
    const compare = jest.spyOn(nodeCrypto, 'timingSafeEqual');
    await attempt(contest, basic('feed', `${key}x`)).catch(() => undefined);
    await attempt(contest, basic('feed', key));
    expect(compare).toHaveBeenCalledTimes(2);
    compare.mockRestore();
  });

  it.each([
    ['no header', undefined],
    ['a Bearer header', 'Bearer abc'],
    ['another user name', 'USER'],
    ['a wrong key', 'WRONG'],
  ])(
    'refuses %s with the one 401 and a Basic challenge',
    async (_name, header) => {
      const contest = await newContest();
      const { key } = await mint(contest);
      const value =
        header === 'USER'
          ? basic('bob', key)
          : header === 'WRONG'
            ? basic('feed', `${key}x`)
            : header;
      await expect(attempt(contest, value)).rejects.toMatchObject({
        status: 401,
        code: 'unauthorized',
        headers: { 'WWW-Authenticate': 'Basic realm="feed"' },
      });
    },
  );

  it('answers an unknown contest exactly like a wrong key', async () => {
    const wrong = await attempt(
      { key: 'no_such_contest' } as Contest,
      basic('feed', 'qhf_x'),
    ).catch((error: Error) => error);
    const contest = await newContest();
    await mint(contest);
    const real = await attempt(contest, basic('feed', 'qhf_x')).catch(
      (error: Error) => error,
    );
    expect(wrong).toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: (real as Error).message,
    });
  });

  it('refuses an expired key, a revoked key, a deactivated owner and an owner who lost the editor right', async () => {
    const contest = await newContest();
    const { key } = await mint(contest);
    const header = basic('feed', key);
    await expect(
      attempt(contest, header, new Date(Date.now() + 15 * 86_400_000)),
    ).rejects.toMatchObject({ status: 401 });
    await api.contests.updateOne({ _id: contest._id }, { authors: [] });
    await expect(attempt(contest, header)).rejects.toMatchObject({
      status: 401,
    });
    await api.contests.updateOne(
      { _id: contest._id },
      { authors: [users.editor._id] },
    );
    await expect(attempt(contest, header)).resolves.toBeDefined();
    await api.users.updateOne({ _id: users.editor._id }, { isActive: false });
    await expect(attempt(contest, header)).rejects.toMatchObject({
      status: 401,
    });
    await api.users.updateOne({ _id: users.editor._id }, { isActive: true });
    await authed(api.http().delete(url(contest)), sessions.editor).expect(204);
    await expect(attempt(contest, header)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('locks an IP after five wrong attempts, even for the right key, and lets successes pass freely', async () => {
    const contest = await newContest();
    const { key } = await mint(contest);
    for (let count = 0; count < 10; count += 1)
      await attempt(contest, basic('feed', key));
    for (let count = 0; count < 5; count += 1)
      await expect(
        attempt(contest, basic('feed', 'wrong')),
      ).rejects.toMatchObject({ status: 401 });
    await expect(
      attempt(contest, basic('feed', 'wrong')),
    ).rejects.toMatchObject({ status: 429 });
    await expect(attempt(contest, basic('feed', key))).rejects.toMatchObject({
      status: 429,
    });
  });

  it('allows a key 60 requests a minute', async () => {
    const contest = await newContest();
    const { key } = await mint(contest);
    for (let count = 0; count < 60; count += 1)
      await attempt(contest, basic('feed', key));
    await expect(attempt(contest, basic('feed', key))).rejects.toMatchObject({
      status: 429,
    });
  });

  it('re-checks a key without spending the request budgets, and refuses it once the key is revoked', async () => {
    const contest = await newContest();
    const { key } = await mint(contest);
    const context = await attempt(contest, basic('feed', key));
    for (let count = 0; count < 70; count += 1)
      await auth.reauthorize(contest._id, context.feedKey.id);
    await authed(api.http().delete(url(contest)), sessions.editor).expect(204);
    await expect(
      auth.reauthorize(contest._id, context.feedKey.id),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('releases the active key during a freeze: 409 without a key, 409 when no freeze is on, 204 and a release time otherwise', async () => {
    const frozen = await frozenContest();
    await authed(api.http().post(url(frozen, '/release')), sessions.editor)
      .expect(409)
      .expect(errorCode('no_active_feed_key'));
    const { key } = await mint(frozen);
    await authed(
      api.http().post(url(frozen, '/release')),
      sessions.editor,
    ).expect(204);
    const status = dataOf<FeedKeyStatusResponse>(
      await authed(api.http().get(url(frozen)), sessions.editor).expect(200),
    );
    expect(status.releasedAt).not.toBeNull();
    expect(
      (await attempt(frozen, basic('feed', key))).feedKey.releasedAt,
    ).not.toBeNull();
    const calm = await newContest();
    await mint(calm);
    await authed(api.http().post(url(calm, '/release')), sessions.editor)
      .expect(409)
      .expect(errorCode('not_frozen'));
    expect(
      (await api.feedKeys.findOne({ contest: calm._id }).lean())!.releasedAt,
    ).toBeNull();
  });

  it('once an IP is locked by fake contest keys, answers every contest the same 429, real, hidden or made up', async () => {
    const hidden = await createContest(api, {
      authors: [users.editor._id],
      isVisible: false,
    });
    const { key } = await mint(hidden);
    for (let count = 0; count < 5; count += 1)
      await expect(
        attempt({ key: `fake_${count}` } as Contest, basic('feed', 'qhf_x')),
      ).rejects.toMatchObject({ status: 401 });
    const statusOf = (answer: Promise<unknown>) =>
      answer.then(
        () => 200,
        (error: { status: number }) => error.status,
      );
    expect([
      await statusOf(
        attempt({ key: 'fake_5' } as Contest, basic('feed', 'qhf_x')),
      ),
      await statusOf(attempt(hidden, basic('feed', 'qhf_x'))),
      await statusOf(attempt(hidden, basic('feed', key))),
    ]).toEqual([429, 429, 429]);
  });

  it('lets only editors mint, revoke, release and read the status', async () => {
    const contest = await newContest();
    await authed(api.http().post(url(contest)).send({}), sessions.plain).expect(
      403,
    );
    await authed(api.http().get(url(contest)), sessions.plain).expect(403);
    await authed(api.http().delete(url(contest)), sessions.plain).expect(403);
    await authed(
      api.http().post(url(contest, '/release')),
      sessions.plain,
    ).expect(403);
    await api.http().post(url(contest)).send({}).expect(401);
  });

  it('refuses minting, revoking and releasing to an API token and to an impersonated session', async () => {
    const contest = await newContest();
    await mint(contest);
    const { token, hash } = generateApiToken(
      users.editor._id,
      TEST_ENV.TOKEN_SECRET,
    );
    await api.users.updateOne(
      { _id: users.editor._id },
      { apiTokenHash: hash },
    );
    for (const [method, suffix] of [
      ['post', ''],
      ['delete', ''],
      ['post', '/release'],
    ] as const)
      await api
        .http()
        [method](url(contest, suffix))
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
    const { id, session } = await api.sessions.create({
      userId: users.editor._id,
      twoFaPassed: true,
      passwordPwned: false,
      impersonatorId: users.admin._id,
    });
    const impersonated = { cookie: sessionCookie(id), csrf: session.csrf };
    for (const [method, suffix] of [
      ['post', ''],
      ['delete', ''],
      ['post', '/release'],
    ] as const)
      await authed(
        api.http()[method](url(contest, suffix)).send({}),
        impersonated,
      ).expect(403);
    expect(
      await api.feedKeys.countDocuments({
        contest: contest._id,
        revokedAt: null,
      }),
    ).toBe(1);
  });

  it('limits minting to five an hour per contest and user, and logs each credential action with the actor', async () => {
    const contest = await frozenContest();
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    for (let count = 0; count < 5; count += 1) await mint(contest);
    await authed(
      api.http().post(url(contest)).send({}),
      sessions.editor,
    ).expect(429);
    await authed(
      api.http().post(url(contest, '/release')),
      sessions.editor,
    ).expect(204);
    await authed(api.http().delete(url(contest)), sessions.editor).expect(204);
    const events = log.mock.calls.map(
      ([entry]) =>
        entry as { event: string; actorId: string; contestId: string },
    );
    expect(events.map((entry) => entry.event)).toEqual(
      expect.arrayContaining([
        'feed-key.minted',
        'feed-key.released',
        'feed-key.revoked',
      ]),
    );
    for (const entry of events.filter((item) =>
      item.event?.startsWith('feed-key.'),
    ))
      expect(entry).toMatchObject({
        actorId: users.editor._id,
        contestId: contest._id,
      });
    expect(JSON.stringify(events)).not.toMatch(/qhf_/);
    log.mockRestore();
  });
});
