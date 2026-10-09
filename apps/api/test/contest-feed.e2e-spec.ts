import { profileQueries } from '@libs/database/testing';
import type { Contest, User } from '@libs/database';
import type { FeedEvent } from '@libs/contests';
import type { MintedFeedKeyResponse } from '../src/modules/contests/feed/dto/feed-key.dto';
import { FeedAuthService } from '../src/modules/contests/feed/feed-auth.service';
import {
  DEFAULT_FEED_LIMITS,
  FEED_LIMITS,
  FeedService,
  newFeedSession,
} from '../src/modules/contests/feed/feed.service';
import {
  clearRateLimits,
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const basic = (key: string) =>
  `Basic ${Buffer.from(`feed:${key}`).toString('base64')}`;

describe('contest event feed', () => {
  const limits = { ...DEFAULT_FEED_LIMITS };
  let api: ApiTest;
  let auth: FeedAuthService;
  let feeds: FeedService;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Array<{ _id: string }> = [];
  const url = (contest: Contest) => contestUrl(contest.key, '/feed');
  const mint = async (contest: Contest, body: object = {}) =>
    dataOf<MintedFeedKeyResponse>(
      await authed(
        api.http().post(contestUrl(contest.key, '/feed-key')).send(body),
        sessions.editor,
      ).expect(201),
    ).key;
  const fetchFeed = async (
    contest: Contest,
    key: string,
  ): Promise<FeedEvent[]> => {
    const response = await api
      .http()
      .get(url(contest))
      .set('Authorization', basic(key))
      .expect(200);
    return response.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as FeedEvent);
  };
  const ids = (events: FeedEvent[], type: string) =>
    events.filter((event) => event.type === type).map((event) => event.id);

  /** A team's contest submission at `date`, judged `result` (null: still queued). */
  const submit = async (
    contest: Contest,
    [user, participation]: [string, string],
    date: Date,
    result: 'AC' | 'WA' | 'CE' | 'IE' | null,
  ) => {
    const submission = await seedSubmission(api, {
      user,
      problem: problems[0]._id,
      language: catalog.languages.cpp,
      date,
      contest: contest._id,
      status: result === null ? 'QU' : 'D',
      result,
      judgedDate: result === null ? null : new Date(date.getTime() + 1000),
    });
    await api.contestSubmissions.create({
      _id: submission._id,
      participation,
      contest: contest._id,
      problem: problems[0]._id,
      points: result === 'AC' ? 100 : 0,
    });
    return submission;
  };

  const seed = async (extra: Partial<Contest> = {}) => {
    const contest = await createContest(api, {
      formatName: 'icpc',
      authors: [users.editor._id],
      problems: [contestProblem(problems[0]._id, 0)],
      ...extra,
    });
    const ann = await joinParticipation(api, contest._id, users.ann._id);
    const bob = await joinParticipation(api, contest._id, users.bob._id);
    return { contest, ann, bob };
  };

  beforeAll(async () => {
    api = await setupApiTest({
      overrides: [{ provide: FEED_LIMITS, useValue: limits }],
    });
    auth = api.app.get(FeedAuthService);
    feeds = api.app.get(FeedService);
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['editor', { permissions: ['judge.edit_own_contest'] }],
      ['ann', {}],
      ['bob', {}],
      ['dave', {}],
      ['carol', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problems.push(
      await createProblem(api, catalog, { code: 'feed_a' }),
      await createProblem(api, catalog, { code: 'feed_b' }),
    );
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearRateLimits(api));
  afterEach(() => {
    Object.assign(limits, DEFAULT_FEED_LIMITS);
  });

  it('serves a structurally valid NDJSON feed of live, non-disqualified teams only', async () => {
    const { contest, ann, bob } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    const dave = await joinParticipation(api, contest._id, users.dave._id, {
      virtual: 1,
    });
    const carol = await joinParticipation(api, contest._id, users.carol._id, {
      isDisqualified: true,
    });
    const first = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2.5),
      'WA',
    );
    const second = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2),
      'AC',
    );
    await submit(contest, [users.bob._id, bob._id], hoursFromNow(-1.5), null);
    await submit(contest, [users.dave._id, dave._id], hoursFromNow(-2), 'AC');
    await submit(contest, [users.carol._id, carol._id], hoursFromNow(-2), 'AC');
    const response = await api
      .http()
      .get(url(contest))
      .set('Authorization', basic(await mint(contest)))
      .expect(200);
    expect(response.headers['content-type']).toMatch(/application\/x-ndjson/);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    const events = response.text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as FeedEvent);
    expect(events[0].type).toBe('contest');
    expect(events.at(-1)!.type).toBe('state');
    expect(ids(events, 'teams').sort()).toEqual([ann._id, bob._id].sort());
    expect(ids(events, 'submissions')).toEqual([
      first._id,
      second._id,
      expect.any(String),
    ]);
    expect(ids(events, 'judgements')).toEqual([first._id, second._id]);
    expect(ids(events, 'problems')).toEqual([problems[0]._id]);
    const seen = new Set<string>();
    for (const event of events) {
      for (const field of [
        'team_id',
        'problem_id',
        'language_id',
        'submission_id',
      ] as const)
        if (event.data[field])
          expect(seen.has(event.data[field] as string)).toBe(true);
      seen.add(String(event.id));
    }
  });

  it("shows the viewer's team a group only for a listed organization", async () => {
    const { contest } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    const listed = await api.organizations.create({
      name: 'Listed School',
      slug: 'listed',
      shortName: 'LS',
      isUnlisted: false,
    });
    const unlisted = await api.organizations.create({
      name: 'Secret Club',
      slug: 'secret',
      shortName: 'SC',
      isUnlisted: true,
    });
    await api.users.updateOne(
      { _id: users.ann._id },
      { organizations: [listed._id] },
    );
    await api.users.updateOne(
      { _id: users.bob._id },
      { organizations: [unlisted._id] },
    );
    const events = await fetchFeed(contest, await mint(contest));
    expect(
      events
        .filter((event) => event.type === 'groups')
        .map((event) => event.data.name),
    ).toEqual(['Listed School']);
    expect(JSON.stringify(events)).not.toContain('Secret Club');
  });

  it('answers every failure with the same 401 and a Basic challenge', async () => {
    const { contest } = await seed();
    const key = await mint(contest);
    const wrong = await api
      .http()
      .get(url(contest))
      .set('Authorization', basic(`${key}x`))
      .expect(401);
    expect(wrong.headers['www-authenticate']).toBe('Basic realm="feed"');
    await api.http().get(url(contest)).expect(401);
    await authed(api.http().get(url(contest)), sessions.editor).expect(401);
    const unknown = await api
      .http()
      .get(contestUrl('no_such_contest', '/feed'))
      .set('Authorization', basic(key))
      .expect(401);
    expect(unknown.body).toEqual(wrong.body);
    await authed(
      api.http().delete(contestUrl(contest.key, '/feed-key')),
      sessions.editor,
    ).expect(204);
    await api
      .http()
      .get(url(contest))
      .set('Authorization', basic(key))
      .expect(401);
  });

  it('keys the failure lock by the trusted client address, not by a forwarded header', async () => {
    const { contest } = await seed();
    const key = await mint(contest);
    for (let attempt = 0; attempt < 5; attempt += 1)
      await api
        .http()
        .get(url(contest))
        .set('Authorization', basic('wrong'))
        .set('X-Forwarded-For', `198.51.100.${attempt}`)
        .expect(401);
    const locked = await api
      .http()
      .get(url(contest))
      .set('Authorization', basic(key))
      .set('X-Forwarded-For', '198.51.100.99')
      .expect(429);
    expect(locked.status).toBe(429);
  });

  it('cuts the feed at the freeze until the key is released, the contest unfreezes, or the key is live', async () => {
    const { contest, ann } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(0.5),
      frozenLastMinutes: 60,
    });
    const before = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2),
      'AC',
    );
    const frozen = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-0.1),
      'WA',
    );
    const key = await mint(contest);
    const gated = await fetchFeed(contest, key);
    expect(ids(gated, 'submissions')).toEqual([before._id]);
    expect(ids(gated, 'judgements')).toEqual([before._id]);
    expect(gated.at(-1)!.data.frozen).not.toBeNull();
    expect(JSON.stringify(gated)).not.toContain(frozen._id);
    expect(
      ids(
        await fetchFeed(contest, await mint(contest, { mode: 'live' })),
        'submissions',
      ),
    ).toEqual([before._id, frozen._id]);
    const gatedAgain = await mint(contest);
    expect(ids(await fetchFeed(contest, gatedAgain), 'submissions')).toEqual([
      before._id,
    ]);
    await authed(
      api.http().post(contestUrl(contest.key, '/feed-key/release')),
      sessions.editor,
    ).expect(204);
    expect(ids(await fetchFeed(contest, gatedAgain), 'submissions')).toEqual([
      before._id,
      frozen._id,
    ]);
    const again = await mint(contest);
    expect(ids(await fetchFeed(contest, again), 'submissions')).toEqual([
      before._id,
    ]);
    await api.contests.updateOne(
      { _id: contest._id },
      { frozenLastMinutes: 0 },
    );
    expect(ids(await fetchFeed(contest, again), 'submissions')).toEqual([
      before._id,
      frozen._id,
    ]);
  });

  it('treats a release made before the current freeze as no release, and one made during it as a release', async () => {
    const { contest, ann } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(0.5),
      frozenLastMinutes: 60,
    });
    const before = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2),
      'AC',
    );
    const frozen = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-0.1),
      'WA',
    );
    const key = await mint(contest);
    await api.feedKeys.updateOne(
      { contest: contest._id },
      { releasedAt: hoursFromNow(-5) },
    );
    const stale = await fetchFeed(contest, key);
    expect(ids(stale, 'submissions')).toEqual([before._id]);
    expect(stale.at(-1)!.data.thawed).toBeNull();
    await api.feedKeys.updateOne(
      { contest: contest._id },
      { releasedAt: new Date() },
    );
    expect(ids(await fetchFeed(contest, key), 'submissions')).toEqual([
      before._id,
      frozen._id,
    ]);
  });

  it('leaves out a submission of a problem that left the contest, so no id dangles', async () => {
    const { contest, ann } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    const kept = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2.5),
      'AC',
    );
    const orphan = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2.4),
      'AC',
    );
    await api.contestSubmissions.updateOne(
      { _id: orphan._id },
      { problem: problems[1]._id },
    );
    const events = await fetchFeed(contest, await mint(contest));
    expect(ids(events, 'submissions')).toEqual([kept._id]);
    expect(ids(events, 'judgements')).toEqual([kept._id]);
    expect(JSON.stringify(events)).not.toContain(problems[1]._id);
  });

  it('publishes judgement types for the verdicts, none for internal errors, and nothing for a queued submission', async () => {
    const { contest, ann } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    const ce = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2.5),
      'CE',
    );
    await submit(contest, [users.ann._id, ann._id], hoursFromNow(-2.4), 'IE');
    await submit(contest, [users.ann._id, ann._id], hoursFromNow(-2.3), null);
    const events = await fetchFeed(contest, await mint(contest));
    expect(
      events
        .filter((event) => event.type === 'judgements')
        .map((event) => [event.id, event.data.judgement_type_id]),
    ).toEqual([[ce._id, 'CE']]);
    expect(ids(events, 'submissions')).toHaveLength(3);
  });

  it('refuses a feed past the size cap', async () => {
    const { contest, ann } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    await submit(contest, [users.ann._id, ann._id], hoursFromNow(-2), 'AC');
    await submit(contest, [users.ann._id, ann._id], hoursFromNow(-1.9), 'WA');
    const key = await mint(contest);
    limits.maxSubmissions = 1;
    await api
      .http()
      .get(url(contest))
      .set('Authorization', basic(key))
      .expect(409)
      .expect(errorCode('feed_too_large'));
    limits.maxSubmissions = 2;
    expect(ids(await fetchFeed(contest, key), 'submissions')).toHaveLength(2);
  });

  it('refuses a stream session past the stream cap, reads everything on the first tick and only the changes on the next', async () => {
    const { contest, ann } = await seed({
      startTime: hoursFromNow(-3),
      endTime: hoursFromNow(-1),
    });
    const first = await submit(
      contest,
      [users.ann._id, ann._id],
      hoursFromNow(-2),
      'AC',
    );
    const context = await auth.authorize(
      { authorization: basic(await mint(contest)), ip: '203.0.113.7' },
      contest.key,
    );
    limits.maxStreamSubmissions = 0;
    await expect(
      feeds.eventsFor(context, new Date(), newFeedSession()),
    ).rejects.toMatchObject({ code: 'feed_too_large_for_stream' });
    expect(ids(await feeds.eventsFor(context), 'submissions')).toEqual([
      first._id,
    ]);
    limits.maxStreamSubmissions = DEFAULT_FEED_LIMITS.maxStreamSubmissions;
    const session = newFeedSession();
    expect(
      ids(await feeds.eventsFor(context, new Date(), session), 'submissions'),
    ).toEqual([first._id]);
    const quiet = await profileQueries(api.db, () =>
      feeds.eventsFor(context, new Date(), session),
    );
    expect(
      quiet.filter(
        (operation) => operation.collection === 'contestSubmissions',
      ),
    ).toEqual([]);
    const second = await submit(
      contest,
      [users.ann._id, ann._id],
      new Date(),
      'WA',
    );
    expect(
      ids(await feeds.eventsFor(context, new Date(), session), 'submissions'),
    ).toEqual([first._id, second._id]);
  });
});
