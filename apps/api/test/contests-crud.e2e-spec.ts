import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_RATING_QUEUE, CONTEST_RESCORE_QUEUE } from '@libs/contests';
import type { ContestRatingJob, ContestRescoreJob } from '@libs/contests';
import { newId } from '@libs/database';
import type { User } from '@libs/database';
import type { ContestDetailResponse } from '../src/modules/contests/core/dto/contest-detail.response';
import type { ContestListItemResponse } from '../src/modules/contests/core/dto/contest-list.response';
import {
  contestProblem,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
  makeCurrent,
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

const CONTESTS = '/api/internal/contests';

describe('contest CRUD', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let rescores: Queue<ContestRescoreJob>;
  let ratingQueue: Queue<ContestRatingJob>;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const problems: Record<string, { _id: string }> = {};
  const body = (extra: object = {}) => ({
    key: `round_${Math.random().toString(36).slice(2, 10)}`,
    name: 'Round',
    startTime: hoursFromNow(1).toISOString(),
    endTime: hoursFromNow(4).toISOString(),
    ...extra,
  });
  const create = (who: string, extra: object = {}) =>
    authed(api.http().post(CONTESTS), sessions[who]).send(body(extra));
  const patch = (who: string, key: string, changes: object) =>
    authed(api.http().patch(contestUrl(key)), sessions[who]).send(changes);
  const detail = async (key: string, who?: string) => {
    const request = api.http().get(contestUrl(key));
    return dataOf<ContestDetailResponse>(
      await (who ? authed(request, sessions[who]) : request).expect(200),
    );
  };
  const fieldsOf = ({ body: response }: { body: unknown }) =>
    Object.keys(
      (response as { error: { fields?: object } }).error.fields ?? {},
    );

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    rescores = api.app.get(getQueueToken(CONTEST_RESCORE_QUEUE));
    ratingQueue = api.app.get(getQueueToken(CONTEST_RATING_QUEUE));
    const roles: Array<[string, Partial<User>]> = [
      [
        'creator',
        {
          permissions: [
            'judge.add_contest',
            'judge.edit_own_contest',
            'judge.contest_access_code',
          ],
        },
      ],
      [
        'longCreator',
        { permissions: ['judge.add_contest', 'judge.long_contest_duration'] },
      ],
      [
        'privateCreator',
        { permissions: ['judge.add_contest', 'judge.create_private_contest'] },
      ],
      ['rater', { permissions: ['judge.add_contest', 'judge.contest_rating'] }],
      ['codeless', { permissions: ['judge.edit_own_contest'] }],
      ['tester', {}],
      ['author', {}],
      ['plain', {}],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problems.open = await createProblem(api, catalog, { code: 'open' });
    problems.second = await createProblem(api, catalog, { code: 'second' });
    problems.secret = await createProblem(api, catalog, {
      code: 'secret',
      isPublic: false,
    });
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await rescores.obliterate({ force: true });
    await ratingQueue.obliterate({ force: true });
  });

  describe('create', () => {
    it('needs judge.add_contest', () =>
      create('plain').expect(403).expect(errorCode('forbidden')));

    it('makes the creator an author, renders the description and hashes the access code', async () => {
      const response = await create('creator', {
        description: 'Solve **all**',
        accessCode: 'letmein',
        problems: [{ problem: problems.open._id, points: 50 }],
        labelStyle: 'alpha',
      }).expect(201);
      const created = dataOf<ContestDetailResponse>(response);
      expect(created.authors.map((author) => author.username)).toEqual([
        'creator',
      ]);
      expect(created.descriptionHtml).toContain('<strong>all</strong>');
      expect(created.requiresAccessCode).toBe(true);
      expect(JSON.stringify(response.body)).not.toContain('letmein');
      const stored = (await api.contests.findOne({ key: created.key }).lean())!;
      expect(stored.accessCodeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(stored.formatConfig).toEqual({});
      expect(stored.problems).toMatchObject([
        { points: 50, order: 0, partial: true },
      ]);
    });

    it("fills the chosen format's defaults when a create sends no config", async () => {
      const created = dataOf<ContestDetailResponse>(
        await create('creator', { formatName: 'icpc' }).expect(201),
      );
      expect(
        (await api.contests.findOne({ key: created.key }).lean())!.formatConfig,
      ).toEqual({ penalty: 20 });
    });

    it('lists the creator once among the authors', async () => {
      const created = dataOf<ContestDetailResponse>(
        await create('creator', { authors: [users.creator._id] }).expect(201),
      );
      expect(created.authors).toHaveLength(1);
      const stored = await api.contests.findOne({ key: created.key }).lean();
      expect(stored!.authors).toHaveLength(1);
    });

    it('stores no hash for an empty access code', async () => {
      const created = dataOf<ContestDetailResponse>(
        await create('creator', { accessCode: '' }).expect(201),
      );
      expect(created.requiresAccessCode).toBe(false);
      expect(
        (await api.contests.findOne({ key: created.key }).lean())!
          .accessCodeHash,
      ).toBeNull();
    });

    it.each([
      [
        'an end before the start',
        { startTime: hoursFromNow(5).toISOString() },
        'endTime',
      ],
      [
        'a registration ending after the contest',
        { registrationEnd: hoursFromNow(9).toISOString() },
        'registrationEnd',
      ],
      [
        'a registration starting after the contest start',
        { registrationStart: hoursFromNow(2).toISOString() },
        'registrationStart',
      ],
      [
        'an invalid format config',
        { formatName: 'icpc', formatConfig: { penalty: -5 } },
        'formatConfig',
      ],
      [
        'a config key of another format',
        { formatConfig: { penalty: 5 } },
        'formatConfig',
      ],
      ['the reserved key current', { key: 'current' }, 'key'],
      [
        'an invisible problem',
        { problems: [{ problem: 'PLACEHOLDER', points: 1 }] },
        'problems',
      ],
      [
        'the same problem twice',
        {
          problems: [
            { problem: 'OPEN', points: 1 },
            { problem: 'OPEN', points: 2 },
          ],
        },
        'problems',
      ],
      [
        'an unknown author',
        { authors: ['0190a0a0-0000-7000-8000-000000000000'] },
        'authors',
      ],
    ])('rejects %s', async (_case, extra, field) => {
      const withIds = JSON.parse(
        JSON.stringify(extra)
          .replace('PLACEHOLDER', problems.secret._id)
          .replaceAll('OPEN', problems.open._id),
      ) as object;
      expect(fieldsOf(await create('creator', withIds).expect(400))).toContain(
        field,
      );
    });

    it('limits the duration to 14 days without judge.long_contest_duration', async () => {
      const long = {
        startTime: hoursFromNow(1).toISOString(),
        endTime: hoursFromNow(1 + 15 * 24).toISOString(),
      };
      expect(fieldsOf(await create('creator', long).expect(400))).toEqual([
        'endTime',
      ]);
      await create('longCreator', long).expect(201);
      // 14 days and 23 hours still count as 14 (legacy `timedelta.days`).
      await create('creator', {
        ...long,
        endTime: hoursFromNow(1 + 14 * 24 + 23).toISOString(),
      }).expect(201);
    });

    it('answers 409 for a taken key', async () => {
      await create('creator', { key: 'taken' }).expect(201);
      await create('creator', { key: 'taken' })
        .expect(409)
        .expect(errorCode('conflict'));
    });

    it.each([
      ['rating', { isRated: true }, 'creator', 'rater'],
      ['privacy', { isPrivate: true }, 'creator', 'privateCreator'],
    ])(
      'gates %s fields on their permission',
      async (_case, fields, without, withPermission) => {
        await create(without, fields)
          .expect(403)
          .expect(errorCode('forbidden'));
        await create(withPermission, fields).expect(201);
      },
    );

    it('lets a private-contest creator make only a private contest visible', async () => {
      await create('privateCreator', { isVisible: true }).expect(403);
      await create('privateCreator', {
        isVisible: true,
        isPrivate: true,
      }).expect(201);
      await create('creator', { isVisible: true, isPrivate: true }).expect(403);
    });
  });

  describe('list and detail', () => {
    it('lists visible contests by phase, tag, rating and search, newest first', async () => {
      const tag = `t${Date.now() % 100000}`;
      const past = await createContest(api, {
        name: 'Past Cup',
        startTime: hoursFromNow(-9),
        endTime: hoursFromNow(-8),
        tags: [tag],
      });
      const live = await createContest(api, {
        name: 'Live Cup',
        tags: [tag],
        isRated: true,
      });
      const future = await createContest(api, {
        name: 'Future Cup',
        startTime: hoursFromNow(5),
        endTime: hoursFromNow(6),
        tags: [tag],
      });
      await createContest(api, {
        name: 'Hidden Cup',
        isVisible: false,
        tags: [tag],
      });
      const keysOf = async (query: string) =>
        dataOf<ContestListItemResponse[]>(
          await api.http().get(`${CONTESTS}?tag=${tag}${query}`).expect(200),
        ).map((contest) => contest.key);
      expect(await keysOf('')).toEqual([future.key, live.key, past.key]);
      expect(await keysOf('&phase=running')).toEqual([live.key]);
      expect(await keysOf('&phase=upcoming')).toEqual([future.key]);
      expect(await keysOf('&phase=ended')).toEqual([past.key]);
      expect(await keysOf('&rated=true')).toEqual([live.key]);
      expect(await keysOf('&search=fUtUrE')).toEqual([future.key]);
      const page = await api
        .http()
        .get(`${CONTESTS}?tag=${tag}&pageSize=2&page=2`)
        .expect(200);
      expect((page.body as { meta: { total: number } }).meta.total).toBe(3);
      expect(
        dataOf<ContestListItemResponse[]>(page).map((contest) => contest.key),
      ).toEqual([past.key]);
    });

    it('hides an invisible contest as 404 and its problems until it ends, unless the viewer edits it', async () => {
      const hidden = await createContest(api, { isVisible: false });
      await api
        .http()
        .get(contestUrl(hidden.key))
        .expect(404)
        .expect(errorCode('not_found'));
      await api.http().get(contestUrl('NOT_A_KEY')).expect(404);
      const problemsOf = [
        contestProblem(problems.open._id, 0),
        contestProblem(problems.secret._id, 1),
      ];
      const running = await createContest(api, {
        problems: problemsOf,
        authors: [users.creator._id],
        labelStyle: 'alpha',
      });
      expect((await detail(running.key, 'plain')).problems).toBeNull();
      expect(
        (await detail(running.key, 'creator')).problems?.map((problem) => [
          problem.label,
          problem.code,
        ]),
      ).toEqual([
        ['A', 'open'],
        ['B', 'secret'],
      ]);
      const ended = await createContest(api, {
        problems: problemsOf,
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      expect((await detail(ended.key)).problems).toHaveLength(2);
      expect((await detail(ended.key)).settings).toBeNull();
    });

    it('shows problems to testers, to participants in the contest and to authors without edit permission', async () => {
      const problemsOf = [contestProblem(problems.open._id, 0)];
      const contest = await createContest(api, {
        problems: problemsOf,
        testers: [users.tester._id],
        authors: [users.author._id],
      });
      const tester = await detail(contest.key, 'tester');
      expect([tester.viewer.isTester, tester.problems]).toEqual([
        true,
        expect.any(Array),
      ]);
      const author = await detail(contest.key, 'author');
      expect([author.viewer.isEditor, author.viewer.canEdit]).toEqual([
        true,
        false,
      ]);
      expect(author.problems).toHaveLength(1);

      expect((await detail(contest.key, 'plain')).problems).toBeNull();
      const joined = await joinParticipation(api, contest._id, users.plain._id);
      const elsewhere = await createContest(api);
      const other = await joinParticipation(
        api,
        elsewhere._id,
        users.plain._id,
      );
      await makeCurrent(api, users.plain._id, other._id);
      expect((await detail(contest.key, 'plain')).viewer.inContest).toBe(false);
      expect((await detail(contest.key, 'plain')).problems).toBeNull();
      await makeCurrent(api, users.plain._id, joined._id);
      const inside = await detail(contest.key, 'plain');
      expect(inside.viewer.inContest).toBe(true);
      expect(inside.problems).toHaveLength(1);
      await makeCurrent(api, users.plain._id, null);
    });

    it('tells a viewer about their live participation', async () => {
      const contest = await createContest(api);
      await joinParticipation(api, contest._id, users.plain._id);
      expect(
        (await detail(contest.key, 'plain')).viewer.liveParticipation,
      ).toMatchObject({ virtual: 0, isRegistered: false });
    });
  });

  describe('edit', () => {
    it('keeps a stored format config across edits that keep the format', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
        formatName: 'icpc',
        formatConfig: { penalty: 10 },
      });
      const storedConfig = async () =>
        (await api.contests.findById(contest._id).lean())!.formatConfig;
      await patch('creator', contest.key, { name: 'Renamed' }).expect(200);
      expect(await storedConfig()).toMatchObject({ penalty: 10 });
      await patch('creator', contest.key, { formatName: 'icpc' }).expect(200);
      expect(await storedConfig()).toMatchObject({ penalty: 10 });
    });

    it('stores a sent date, clears it on null and leaves unsent dates alone', async () => {
      const registrationEnd = hoursFromNow(0.5);
      const contest = await createContest(api, {
        authors: [users.creator._id],
        registrationEnd,
      });
      const storedEnd = async () =>
        (await api.contests.findById(contest._id).lean())!.registrationEnd;
      await patch('creator', contest.key, { name: 'Renamed' }).expect(200);
      expect(await storedEnd()).toEqual(registrationEnd);
      const moved = hoursFromNow(1);
      await patch('creator', contest.key, {
        registrationEnd: moved.toISOString(),
      }).expect(200);
      expect(await storedEnd()).toEqual(moved);
      await patch('creator', contest.key, { registrationEnd: null }).expect(
        200,
      );
      expect(await storedEnd()).toBeNull();
    });

    it('lets only contest editors edit', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
      });
      await patch('plain', contest.key, { name: 'Mine' })
        .expect(403)
        .expect(errorCode('forbidden'));
      await patch('creator', contest.key, { name: 'Renamed' }).expect(200);
      expect((await detail(contest.key)).name).toBe('Renamed');
    });

    it('refuses null on non-nullable fields and keeps the contest unchanged', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
      });
      const response = await patch('creator', contest.key, {
        name: null,
        isRated: null,
        timeLimit: null,
      }).expect(400);
      expect(
        Object.keys(
          (response.body as { error: { fields: object } }).error.fields,
        ).sort(),
      ).toEqual(['isRated', 'name']);
      expect((await detail(contest.key)).name).toBe(contest.name);
      await patch('creator', contest.key, { timeLimit: null }).expect(200);
    });

    it('refuses null partial and isPretested inside problems on create and update', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
      });
      for (const field of ['partial', 'isPretested'])
        for (const response of [
          create('creator', {
            problems: [
              { problem: problems.open._id, points: 5, [field]: null },
            ],
          }),
          patch('creator', contest.key, {
            problems: [
              { problem: problems.open._id, points: 5, [field]: null },
            ],
          }),
        ])
          await response.expect(400).expect(errorCode('validation_failed'));
      await patch('creator', contest.key, {
        problems: [{ problem: problems.open._id, points: 5 }],
      }).expect(200);
    });

    it('keeps the request order of problems and gates the access code on its permission', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id, users.codeless._id],
      });
      const ordered = [problems.second._id, problems.open._id];
      await patch('creator', contest.key, {
        problems: ordered.map((problem) => ({ problem, points: 1 })),
      }).expect(200);
      const shown = (await detail(contest.key, 'creator')).problems!;
      expect(
        shown.map((problem) => [problem.label, problem.problemId]),
      ).toEqual([
        ['1', ordered[0]],
        ['2', ordered[1]],
      ]);
      await patch('codeless', contest.key, { accessCode: 'x' })
        .expect(403)
        .expect(errorCode('forbidden'));
      await patch('codeless', contest.key, { accessCode: '' }).expect(200);
    });

    it("queues a rescore on an editor's request only", async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
      });
      await authed(
        api.http().post(contestUrl(contest.key, '/rescore')),
        sessions.plain,
      ).expect(403);
      expect(
        dataOf<{ queued: boolean }>(
          await authed(
            api.http().post(contestUrl(contest.key, '/rescore')),
            sessions.creator,
          ).expect(202),
        ),
      ).toEqual({ queued: true });
      expect(
        (await rescores.getJobs(['waiting'])).map((job) => job.data.contestId),
      ).toEqual([contest._id]);
    });

    it('queues a rescore only when scoring changes', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
      });
      await patch('creator', contest.key, {
        name: 'Same scoring',
        summary: 'x',
      }).expect(200);
      expect(await rescores.getJobs(['waiting'])).toHaveLength(0);
      await patch('creator', contest.key, { formatName: 'icpc' }).expect(200);
      await patch('creator', contest.key, {
        problems: [{ problem: problems.open._id, points: 10 }],
      }).expect(200);
      await patch('creator', contest.key, { pointsPrecision: 1 }).expect(200);
      await patch('creator', contest.key, { frozenLastMinutes: 30 }).expect(
        200,
      );
      const jobs = await rescores.getJobs(['waiting']);
      expect(jobs.map((job) => job.data.contestId)).toEqual(
        Array(4).fill(contest._id),
      );
      // The new format's defaults replace the old config.
      expect(
        (await api.contests.findById(contest._id).lean())!.formatConfig,
      ).toEqual({ penalty: 20 });
    });

    it('queues a rescore when the contest times move', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
      });
      await patch('creator', contest.key, {
        endTime: new Date(contest.endTime.getTime() + 3_600_000).toISOString(),
      }).expect(200);
      expect(
        (await rescores.getJobs(['waiting'])).map((job) => job.data.contestId),
      ).toEqual([contest._id]);
    });

    it('leaves the re-rating of a moved end to the rescore: the edit queues a rescore and no rating itself', async () => {
      const rated = await createContest(api, { authors: [users.creator._id] });
      const unrated = await createContest(api, {
        authors: [users.creator._id],
      });
      await api.ratings.create({
        user: users.plain._id,
        contest: rated._id,
        participation: newId(),
        contestEndTime: rated.endTime,
        rank: 1,
        rating: 1500,
        mean: 1500,
        performance: 1500,
        lastRated: new Date(),
      });
      const later = (contest: { endTime: Date }) => ({
        endTime: new Date(contest.endTime.getTime() + 3_600_000).toISOString(),
      });
      await patch('creator', unrated.key, later(unrated)).expect(200);
      await patch('creator', rated.key, later(rated)).expect(200);
      expect(await ratingQueue.getJobs(['waiting'])).toHaveLength(0);
      expect(
        (await rescores.getJobs(['waiting']))
          .map((job) => job.data.contestId)
          .sort(),
      ).toEqual([unrated._id, rated._id].sort());
    });

    it('answers 409 when leaving final_submission while the contest holds pending submissions', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
        formatName: 'final_submission',
        formatConfig: { autoJudge: true },
      });
      await patch('creator', contest.key, { formatName: 'ioi' }).expect(200);
      const pending = await createContest(api, {
        authors: [users.creator._id],
        formatName: 'final_submission',
        formatConfig: { autoJudge: true },
      });
      await seedSubmission(api, {
        user: users.plain._id,
        problem: problems.open._id,
        language: catalog.languages.cpp,
        contest: pending._id,
        status: 'PD',
        result: null,
      });
      await patch('creator', pending.key, { formatName: 'ioi' })
        .expect(409)
        .expect(errorCode('conflict'));
      await patch('creator', pending.key, { name: 'Still editable' }).expect(
        200,
      );
    });

    it('lets final_submission be left once only rejected PD rows remain', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
        formatName: 'final_submission',
        formatConfig: { autoJudge: true },
      });
      await seedSubmission(api, {
        user: users.plain._id,
        problem: problems.open._id,
        language: catalog.languages.cpp,
        contest: contest._id,
        status: 'PD',
        result: 'RJ',
      });
      await patch('creator', contest.key, { formatName: 'ioi' }).expect(200);
    });

    it('rejects a null for a required field', async () => {
      const contest = await createContest(api, {
        authors: [users.creator._id],
      });
      expect(
        fieldsOf(
          await patch('creator', contest.key, { startTime: null }).expect(400),
        ),
      ).toEqual(['startTime']);
    });

    it('copies a new lock onto live submissions only (legacy set_locked_after)', async () => {
      const locker = await createUserWith(api, 'locker', {
        permissions: ['judge.edit_own_contest', 'judge.lock_contest'],
      });
      const session = await loginAs(api, locker._id);
      const contest = await createContest(api, {
        authors: [locker._id, users.creator._id],
      });
      const live = await joinParticipation(api, contest._id, users.plain._id);
      const virtual = await joinParticipation(
        api,
        contest._id,
        users.plain._id,
        { virtual: 1 },
      );
      const submissionIn = async (participationId: string) => {
        const submission = await seedSubmission(api, {
          user: users.plain._id,
          problem: problems.open._id,
          language: catalog.languages.cpp,
          contest: contest._id,
        });
        await api.contestSubmissions.create({
          _id: submission._id,
          participation: participationId,
          contest: contest._id,
          problem: problems.open._id,
        });
        return submission._id;
      };
      const liveId = await submissionIn(live._id);
      const virtualId = await submissionIn(virtual._id);
      const lockedAfter = hoursFromNow(10);
      await authed(api.http().patch(contestUrl(contest.key)), session)
        .send({ lockedAfter: lockedAfter.toISOString() })
        .expect(200);
      expect(
        (await api.submissions.findById(liveId).lean())!.lockedAfter,
      ).toEqual(lockedAfter);
      expect(
        (await api.submissions.findById(virtualId).lean())!.lockedAfter,
      ).toBeNull();
      await patch('creator', contest.key, { lockedAfter: null }).expect(403);
    });
  });
});
