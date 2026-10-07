import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { UsersRepository } from '@libs/auth';
import { CONTEST_RESCORE_QUEUE, rankingCacheKey } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { CONTEST_CHEATING_BAN_REASON } from '../src/modules/contests/participation/contest-participation.service';
import {
  contestUrl,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('disqualification', () => {
  let api: ApiTest;
  let rescores: Queue<ContestRescoreJob>;
  let editor: TestSession;
  let editorId: string;
  const disqualify = (
    key: string,
    participationId: string,
    disqualified: boolean,
    session = editor,
  ) =>
    authed(
      api
        .http()
        .post(contestUrl(key, `/participations/${participationId}/disqualify`)),
      session,
    ).send({ disqualified });
  const userOf = async (userId: string) =>
    (await api.users.findById(userId).lean())!;

  beforeAll(async () => {
    process.env.CONTEST_BAN_AFTER_DISQUALIFICATIONS = '2';
    api = await setupApiTest();
    rescores = api.app.get(getQueueToken(CONTEST_RESCORE_QUEUE));
    editorId = (
      await createUserWith(api, 'dq_editor', {
        permissions: ['judge.edit_own_contest'],
      })
    )._id;
    editor = await loginAs(api, editorId);
  });
  afterAll(async () => {
    delete process.env.CONTEST_BAN_AFTER_DISQUALIFICATIONS;
    await api.teardown();
  });
  beforeEach(() => rescores.obliterate({ force: true }));

  it('disqualifies: rescored, banned from the contest, moved out of it; requalifying undoes the ban', async () => {
    const cheater = await createUserWith(api, 'cheater');
    const session = await loginAs(api, cheater._id);
    const contest = await createContest(api, { authors: [editorId] });
    const participation = await joinParticipation(
      api,
      contest._id,
      cheater._id,
    );
    await makeCurrent(api, cheater._id, participation._id);
    const redis = api.app.get<Redis>(REDIS);
    const cacheKey = rankingCacheKey(contest._id, false, false);
    await redis.set(cacheKey, 'stale');
    await disqualify(contest.key, participation._id, true, session)
      .expect(403)
      .expect(errorCode('forbidden'));
    await disqualify(contest.key, participation._id, true).expect(201);
    expect(await redis.exists(cacheKey)).toBe(0);
    expect(
      (await api.participations.findById(participation._id).lean())!
        .isDisqualified,
    ).toBe(true);
    expect(
      (await api.contests.findById(contest._id).lean())!.bannedUsers.map(
        uuidStr,
      ),
    ).toEqual([cheater._id]);
    expect((await userOf(cheater._id)).currentParticipation).toBeNull();
    expect(
      (await rescores.getJobs(['waiting'])).map((job) => job.data.contestId),
    ).toEqual([contest._id]);
    await authed(api.http().post(contestUrl(contest.key, '/join')), session)
      .send({})
      .expect(403);
    await disqualify(contest.key, participation._id, true).expect(201);
    expect(
      (await api.contests.findById(contest._id).lean())!.bannedUsers.map(
        uuidStr,
      ),
    ).toEqual([cheater._id]);
    await disqualify(contest.key, participation._id, false).expect(201);
    expect(
      (await api.contests.findById(contest._id).lean())!.bannedUsers,
    ).toEqual([]);
    const elsewhere = await createContest(api, { authors: [editorId] });
    await disqualify(elsewhere.key, participation._id, true).expect(404);
  });

  it('bans the account at the threshold of disqualifications outside organisation-private contests, and lifts only that ban', async () => {
    const repeat = await createUserWith(api, 'repeat_cheater');
    const session = await loginAs(api, repeat._id);
    const inContest = async (extra = {}) => {
      const contest = await createContest(api, {
        authors: [editorId],
        ...extra,
      });
      return {
        contest,
        participation: await joinParticipation(api, contest._id, repeat._id),
      };
    };
    const first = await inContest();
    const organisation = await inContest({ isOrganizationPrivate: true });
    const second = await inContest();
    await disqualify(first.contest.key, first.participation._id, true).expect(
      201,
    );
    await disqualify(
      organisation.contest.key,
      organisation.participation._id,
      true,
    ).expect(201);
    expect((await userOf(repeat._id)).banReason).toBeNull();
    await authed(
      api.http().get('/api/internal/contests/current'),
      session,
    ).expect(200);
    await disqualify(second.contest.key, second.participation._id, true).expect(
      201,
    );
    expect(await userOf(repeat._id)).toMatchObject({
      banReason: CONTEST_CHEATING_BAN_REASON,
      isUnlisted: true,
      displayRank: 'banned',
    });
    await authed(
      api.http().get('/api/internal/contests/current'),
      session,
    ).expect(401);
    await disqualify(first.contest.key, first.participation._id, false).expect(
      201,
    );
    expect(await userOf(repeat._id)).toMatchObject({
      banReason: null,
      isUnlisted: false,
      displayRank: 'user',
      isActive: true,
    });
    await api.users.updateOne({ _id: repeat._id }, { banReason: 'Spam' });
    await disqualify(first.contest.key, first.participation._id, true).expect(
      201,
    );
    await disqualify(first.contest.key, first.participation._id, false).expect(
      201,
    );
    expect((await userOf(repeat._id)).banReason).toBe('Spam');
  });

  it('leaves a manual ban alone when the lift finds it replaced between the read and the write', async () => {
    const repeat = await createUserWith(api, 'cas_cheater');
    const contests = await Promise.all(
      [1, 2].map(() => createContest(api, { authors: [editorId] })),
    );
    const rows = await Promise.all(
      contests.map(async (contest) => ({
        key: contest.key,
        id: (await joinParticipation(api, contest._id, repeat._id))._id,
      })),
    );
    for (const row of rows) await disqualify(row.key, row.id, true).expect(201);
    const banned = await userOf(repeat._id);
    expect(banned.banReason).toBe(CONTEST_CHEATING_BAN_REASON);
    const users = api.app.get(UsersRepository);
    const findById = users.findById.bind(users);
    jest
      .spyOn(users, 'findById')
      .mockImplementation(async (id: string) =>
        id === repeat._id ? (banned as never) : findById(id),
      );
    await api.users.updateOne({ _id: repeat._id }, { banReason: 'Spam' });
    await disqualify(rows[0].key, rows[0].id, false).expect(201);
    jest.restoreAllMocks();
    expect(await userOf(repeat._id)).toMatchObject({
      banReason: 'Spam',
      isActive: false,
    });
  });

  it('keeps the contest ban equal to the final disqualified state under concurrent opposite requests', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    const user = await createUserWith(api, 'racer');
    const participation = await joinParticipation(api, contest._id, user._id);
    for (let round = 0; round < 15; round += 1) {
      await Promise.all(
        [true, false, true, false].map((value) =>
          disqualify(contest.key, participation._id, value),
        ),
      );
      const row = (await api.participations
        .findById(participation._id)
        .lean())!;
      const banned = (await api.contests
        .findById(contest._id)
        .lean())!.bannedUsers.map(uuidStr);
      expect(banned.includes(user._id)).toBe(row.isDisqualified);
    }
  });
});

describe('disqualification with the account ban off (default)', () => {
  let api: ApiTest;
  beforeAll(async () => {
    delete process.env.CONTEST_BAN_AFTER_DISQUALIFICATIONS;
    api = await setupApiTest();
  });
  afterAll(() => api.teardown());

  it('never bans the account, however many disqualifications', async () => {
    const editorId = (
      await createUserWith(api, 'off_editor', {
        permissions: ['judge.edit_own_contest'],
      })
    )._id;
    const editor = await loginAs(api, editorId);
    const cheater = await createUserWith(api, 'off_cheater');
    for (let count = 0; count < 3; count += 1) {
      const contest = await createContest(api, { authors: [editorId] });
      const participation = await joinParticipation(
        api,
        contest._id,
        cheater._id,
      );
      await authed(
        api
          .http()
          .post(
            contestUrl(
              contest.key,
              `/participations/${participation._id}/disqualify`,
            ),
          ),
        editor,
      )
        .send({ disqualified: true })
        .expect(201);
    }
    expect(await api.users.findById(cheater._id).lean()).toMatchObject({
      banReason: null,
      isActive: true,
    });
  });
});
