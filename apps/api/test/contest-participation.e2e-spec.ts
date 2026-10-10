import type Redis from 'ioredis';
import { sha256 } from '@libs/auth';
import { REDIS } from '@libs/common';
import { uuidStr } from '@libs/database';
import { ParticipationsRepository } from '../src/modules/contests/core/participations.repository';
import type { User } from '@libs/database';
import type {
  ContestDetailResponse,
  ParticipationSummaryResponse,
} from '../src/modules/contests/core/dto/contest-detail.response';
import type {
  CurrentParticipationResponse,
  ParticipationResponse,
} from '../src/modules/contests/participation/dto/participation.response';
import {
  clearRateLimits,
  contestUrl,
  createContest,
  hoursFromNow,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('contest participation', () => {
  let api: ApiTest;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const post = (who: string, key: string, action: string, body: object = {}) =>
    authed(api.http().post(contestUrl(key, `/${action}`)), sessions[who]).send(
      body,
    );
  const pointerOf = async (who: string) => {
    const pointer = (await api.users.findById(users[who]._id).lean())!
      .currentParticipation;
    return pointer ? uuidStr(pointer) : null;
  };
  const participationsOf = (contestId: string, who: string) =>
    api.participations
      .find({ contest: contestId, user: users[who]._id })
      .sort({ virtual: 1 })
      .lean();
  const newUser = async (name: string, extra: Partial<User> = {}) => {
    users[name] = await createUserWith(api, name, extra);
    sessions[name] = await loginAs(api, users[name]._id);
  };

  beforeAll(async () => {
    api = await setupApiTest();
    for (const name of [
      'alice',
      'bob',
      'carol',
      'dave',
      'erin',
      'frank',
      'tester',
      'plainauthor',
      'author',
    ])
      await newUser(
        name,
        name === 'author' ? { permissions: ['judge.edit_own_contest'] } : {},
      );
    await newUser('root', { isSuperuser: true });
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearRateLimits(api));

  describe('join', () => {
    it('joins a running contest live, makes it current and counts the user', async () => {
      const contest = await createContest(api);
      const joined = dataOf<ParticipationSummaryResponse>(
        await post('alice', contest.key, 'join').expect(201),
      );
      expect(joined).toMatchObject({ virtual: 0, isRegistered: false });
      expect(await pointerOf('alice')).toBe(joined.id);
      expect((await api.contests.findById(contest._id).lean())!.userCount).toBe(
        1,
      );
      // Joining again re-enters the same participation.
      expect(
        dataOf<ParticipationSummaryResponse>(
          await post('alice', contest.key, 'join').expect(201),
        ).id,
      ).toBe(joined.id);
    });

    it('creates one live participation for concurrent joins and numbers concurrent virtual joins 1..n', async () => {
      const running = await createContest(api);
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => post('bob', running.key, 'join')),
      );
      expect(responses.map((response) => response.status)).toEqual([
        201, 201, 201, 201, 201,
      ]);
      expect(await participationsOf(running._id, 'bob')).toHaveLength(1);
      const ended = await createContest(api, {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      const virtuals = await Promise.all(
        Array.from({ length: 5 }, () => post('bob', ended.key, 'join')),
      );
      expect(virtuals.map((response) => response.status)).toEqual([
        201, 201, 201, 201, 201,
      ]);
      const numbers = (await participationsOf(ended._id, 'bob')).map(
        (row) => row.virtual,
      );
      expect(new Set(numbers).size).toBe(5);
      expect(numbers.every((number) => number >= 1)).toBe(true);
    });

    it('refuses a virtual join when virtual joining is disallowed', async () => {
      const ended = await createContest(api, {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        disallowVirtual: true,
      });
      await post('alice', ended.key, 'join')
        .expect(409)
        .expect(errorCode('virtual_disallowed'));
    });

    it('lets only editors and testers in before the start, as spectators', async () => {
      const upcoming = await createContest(api, {
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(3),
        authors: [users.author._id],
      });
      await post('alice', upcoming.key, 'join')
        .expect(409)
        .expect(errorCode('contest_not_started'));
      expect(
        dataOf<ParticipationSummaryResponse>(
          await post('author', upcoming.key, 'join').expect(201),
        ).virtual,
      ).toBe(-1);
    });

    it('lets a tester in before the start, as a spectator', async () => {
      const upcoming = await createContest(api, {
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(3),
        testers: [users.tester._id],
      });
      expect(
        dataOf<ParticipationSummaryResponse>(
          await post('tester', upcoming.key, 'join').expect(201),
        ).virtual,
      ).toBe(-1);
    });

    it('lets editors join a running contest whose registration closed, as spectators', async () => {
      const contest = await createContest(api, {
        registrationStart: hoursFromNow(-3),
        registrationEnd: hoursFromNow(-2),
        authors: [users.author._id],
        testers: [users.tester._id],
      });
      for (const who of ['author', 'tester'])
        expect(
          dataOf<ParticipationSummaryResponse>(
            await post(who, contest.key, 'join').expect(201),
          ).virtual,
        ).toBe(-1);
    });

    it('lets editors and testers join an ended contest as spectators, never as virtual contestants', async () => {
      const ended = await createContest(api, {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
        authors: [users.author._id],
        testers: [users.tester._id],
      });
      for (const who of ['author', 'tester'])
        expect(
          dataOf<ParticipationSummaryResponse>(
            await post(who, ended.key, 'join').expect(201),
          ).virtual,
        ).toBe(-1);
      expect(await api.contests.findById(ended._id).lean()).toMatchObject({
        virtualCount: 0,
      });
    });

    it('numbers sequential virtual joins 1, 2 and counts them apart from live users', async () => {
      const ended = await createContest(api, {
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      await joinParticipation(api, ended._id, users.alice._id);
      const numbers: number[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1)
        numbers.push(
          dataOf<ParticipationSummaryResponse>(
            await post('carol', ended.key, 'join').expect(201),
          ).virtual,
        );
      expect(numbers).toEqual([1, 2]);
      expect(await api.contests.findById(ended._id).lean()).toMatchObject({
        userCount: 1,
        virtualCount: 2,
      });
    });

    it('keeps banned users out, superusers excepted', async () => {
      const contest = await createContest(api, {
        bannedUsers: [users.carol._id, users.root._id],
      });
      await post('carol', contest.key, 'join')
        .expect(403)
        .expect(errorCode('banned_from_contest'));
      await post('root', contest.key, 'join').expect(201);
    });

    it('moves a live participant whose time ran out to spectating', async () => {
      const contest = await createContest(api, { timeLimit: 600 });
      await joinParticipation(api, contest._id, users.dave._id, {
        realStart: hoursFromNow(-0.5),
      });
      expect(
        dataOf<ParticipationSummaryResponse>(
          await post('dave', contest.key, 'join').expect(201),
        ).virtual,
      ).toBe(-1);
    });
  });

  describe('access codes', () => {
    it('needs the right code, except for editors, and never spends budget on a missing code', async () => {
      const contest = await createContest(api, {
        accessCodeHash: sha256('opensesame'),
        authors: [users.author._id],
      });
      for (let attempt = 0; attempt < 12; attempt += 1)
        await post('alice', contest.key, 'join').expect(403);
      await post('alice', contest.key, 'join')
        .expect(403)
        .expect(errorCode('access_code_required'));
      await post('alice', contest.key, 'join', { accessCode: 'wrong' })
        .expect(403)
        .expect(errorCode('wrong_access_code'));
      await post('alice', contest.key, 'join', {
        accessCode: 'opensesame',
      }).expect(201);
      await post('author', contest.key, 'join').expect(201);
      // An existing participation re-enters without the code.
      await post('alice', contest.key, 'join').expect(201);
    });

    it('asks testers and authors without edit rights for the code', async () => {
      const contest = await createContest(api, {
        accessCodeHash: sha256('opensesame'),
        testers: [users.tester._id],
        authors: [users.plainauthor._id],
      });
      for (const who of ['tester', 'plainauthor']) {
        await post(who, contest.key, 'join').expect(403);
        await post(who, contest.key, 'join', {
          accessCode: 'opensesame',
        }).expect(201);
      }
    });

    it('limits guesses per user, even when the right code comes next', async () => {
      const contest = await createContest(api, {
        accessCodeHash: sha256('opensesame'),
      });
      for (let attempt = 0; attempt < 10; attempt += 1)
        await post('erin', contest.key, 'join', {
          accessCode: `guess${attempt}`,
        }).expect(403);
      await post('erin', contest.key, 'join', { accessCode: 'opensesame' })
        .expect(429)
        .expect(errorCode('rate_limited'));
    });

    it('limits guesses per IP across users', async () => {
      const contest = await createContest(api, {
        accessCodeHash: sha256('opensesame'),
      });
      for (const who of ['alice', 'bob', 'carol'])
        for (let attempt = 0; attempt < 10; attempt += 1)
          await post(who, contest.key, 'join', {
            accessCode: `guess${attempt}`,
          }).expect(403);
      await post('frank', contest.key, 'join', { accessCode: 'guess' }).expect(
        429,
      );
    });

    it('never charges a right code', async () => {
      const contest = await createContest(api, {
        accessCodeHash: sha256('opensesame'),
        startTime: hoursFromNow(-5),
        endTime: hoursFromNow(-1),
      });
      for (let attempt = 0; attempt < 9; attempt += 1)
        await post('frank', contest.key, 'join', { accessCode: 'nope' }).expect(
          403,
        );
      const redis = api.app.get<Redis>(REDIS);
      const ipCounter = async () =>
        redis.get((await redis.keys('rate:contest-code:ip:*'))[0]);
      expect(await ipCounter()).toBe('9');
      for (let attempt = 0; attempt < 3; attempt += 1)
        await post('frank', contest.key, 'join', {
          accessCode: 'opensesame',
        }).expect(201);
      expect(await ipCounter()).toBe('9');
      // The tenth failure is still allowed, the eleventh attempt is not.
      await post('frank', contest.key, 'join', { accessCode: 'nope' }).expect(
        403,
      );
      await post('frank', contest.key, 'join', {
        accessCode: 'opensesame',
      }).expect(429);
    });
  });

  describe('register', () => {
    it('registers inside the window, once, and joining later starts the clock', async () => {
      const contest = await createContest(api, {
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(3),
        registrationStart: hoursFromNow(-1),
        registrationEnd: hoursFromNow(0.5),
      });
      const registered = dataOf<ParticipationSummaryResponse>(
        await post('alice', contest.key, 'register').expect(201),
      );
      expect(registered).toMatchObject({ virtual: 0, isRegistered: true });
      expect(new Date(registered.endTime)).toEqual(contest.endTime);
      await post('alice', contest.key, 'register')
        .expect(409)
        .expect(errorCode('already_registered'));
      expect((await api.contests.findById(contest._id).lean())!.userCount).toBe(
        1,
      );
      await api.contests.updateOne(
        { _id: contest._id },
        {
          startTime: hoursFromNow(-0.1),
          registrationStart: hoursFromNow(-2),
          registrationEnd: hoursFromNow(-1),
        },
      );
      const joined = dataOf<ParticipationSummaryResponse>(
        await post('alice', contest.key, 'join').expect(201),
      );
      expect(joined).toMatchObject({ id: registered.id, isRegistered: false });
      expect(Date.now() - new Date(joined.realStart).getTime()).toBeLessThan(
        60_000,
      );
      // Registration closed: an unregistered user cannot join.
      await post('bob', contest.key, 'join')
        .expect(409)
        .expect(errorCode('not_registered'));
    });

    it.each([
      ['not required', {}, 'alice', 'registration_not_required'],
      [
        'closed',
        {
          registrationStart: hoursFromNow(-3),
          registrationEnd: hoursFromNow(-2),
        },
        'alice',
        'registration_closed',
      ],
      [
        'an editor',
        { registrationEnd: hoursFromNow(0.5) },
        'author',
        'editor_cannot_register',
      ],
      [
        'a tester',
        { registrationEnd: hoursFromNow(0.5) },
        'tester',
        'editor_cannot_register',
      ],
      [
        'over, with an open-ended window',
        {
          startTime: hoursFromNow(-5),
          endTime: hoursFromNow(-1),
          registrationStart: hoursFromNow(-6),
        },
        'alice',
        'contest_ended',
      ],
      [
        'over, with a window that closed too',
        {
          startTime: hoursFromNow(-5),
          endTime: hoursFromNow(-1),
          registrationStart: hoursFromNow(-6),
          registrationEnd: hoursFromNow(-5.5),
        },
        'alice',
        'registration_closed',
      ],
    ])(
      'refuses a registration that is %s',
      async (_case, fields, who, code) => {
        const contest = await createContest(api, {
          startTime: hoursFromNow(1),
          endTime: hoursFromNow(3),
          authors: [users.author._id],
          testers: [users.tester._id],
          ...fields,
        });
        await post(who, contest.key, 'register')
          .expect(409)
          .expect(errorCode(code));
      },
    );

    it('keeps banned users from registering', async () => {
      const contest = await createContest(api, {
        startTime: hoursFromNow(1),
        endTime: hoursFromNow(3),
        registrationEnd: hoursFromNow(0.5),
        bannedUsers: [users.carol._id],
      });
      await post('carol', contest.key, 'register')
        .expect(403)
        .expect(errorCode('banned_from_contest'));
    });
  });

  describe('leave and current', () => {
    it('leaves only the current contest', async () => {
      const contest = await createContest(api);
      const other = await createContest(api);
      await post('carol', contest.key, 'join').expect(201);
      await post('carol', other.key, 'leave')
        .expect(404)
        .expect(errorCode('not_in_contest'));
      await post('carol', contest.key, 'leave').expect(204);
      expect(await pointerOf('carol')).toBeNull();
    });

    it('never clears a pointer that moved to another participation', async () => {
      const contest = await createContest(api);
      const other = await createContest(api);
      const stale = await joinParticipation(api, other._id, users.erin._id);
      const joined = dataOf<ParticipationSummaryResponse>(
        await post('erin', contest.key, 'join').expect(201),
      );
      await api.app
        .get(ParticipationsRepository)
        .clearCurrent(users.erin._id, stale._id);
      expect(await pointerOf('erin')).toBe(joined.id);
    });

    it('reports the current participation and clears it once it ended or became invisible', async () => {
      const current = () =>
        authed(api.http().get('/api/internal/contests/current'), sessions.dave);
      const contest = await createContest(api);
      await post('dave', contest.key, 'join').expect(201);
      expect(
        dataOf<CurrentParticipationResponse>(await current().expect(200)),
      ).toMatchObject({
        contest: { key: contest.key },
        participation: { virtual: 0 },
      });
      await api.contests.updateOne({ _id: contest._id }, { isVisible: false });
      expect(
        dataOf<CurrentParticipationResponse | null>(
          await current().expect(200),
        ),
      ).toBeNull();
      expect(await pointerOf('dave')).toBeNull();
      const short = await createContest(api, { timeLimit: 60 });
      const participation = await joinParticipation(
        api,
        short._id,
        users.dave._id,
        { realStart: hoursFromNow(-1) },
      );
      await makeCurrent(api, users.dave._id, participation._id);
      // Even before a read clears the pointer, an ended participation is not "in the contest".
      expect(
        dataOf<ContestDetailResponse>(
          await authed(
            api.http().get(contestUrl(short.key)),
            sessions.dave,
          ).expect(200),
        ).viewer.inContest,
      ).toBe(false);
      expect(
        dataOf<CurrentParticipationResponse | null>(
          await current().expect(200),
        ),
      ).toBeNull();
      expect(await pointerOf('dave')).toBeNull();
    });
  });

  describe('participations', () => {
    it('lists a user their own participations and an editor everyone, frozen for non-editors during a freeze', async () => {
      const contest = await createContest(api, {
        formatName: 'icpc',
        frozenLastMinutes: 120,
        authors: [users.author._id],
      });
      const results = {
        score: 300,
        cumtime: 50,
        tiebreaker: 9,
        frozenScore: 100,
        frozenCumtime: 20,
        frozenTiebreaker: 4,
        formatData: { P: { points: 300 } },
        frozenFormatData: { P: { points: 100 } },
      };
      await joinParticipation(api, contest._id, users.alice._id, results);
      await joinParticipation(api, contest._id, users.bob._id, results);
      const list = async (who: string, query = '') =>
        dataOf<ParticipationResponse[]>(
          await authed(
            api.http().get(contestUrl(contest.key, `/participations${query}`)),
            sessions[who],
          ).expect(200),
        );
      const own = await list('alice');
      expect(own.map((row) => row.user.username)).toEqual(['alice']);
      expect(own[0]).toMatchObject({ score: 100, cumtime: 20, tiebreaker: 4 });
      expect(own[0].cells).toEqual({ P: { points: 100 } });
      await authed(
        api.http().get(contestUrl(contest.key, '/participations?user=bob')),
        sessions.alice,
      ).expect(403);
      const all = await list('author');
      expect(all.map((row) => row.user.username).sort()).toEqual([
        'alice',
        'bob',
      ]);
      expect(all[0].score).toBe(300);
      expect(
        (await list('author', '?user=bob')).map((row) => row.user.username),
      ).toEqual(['bob']);
    });
  });
});
