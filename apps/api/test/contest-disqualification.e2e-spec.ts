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
import { dataOf } from './submission-fixtures';
import type {
  BulkDisqualifyResponse,
  ParticipationResponse,
} from '../src/modules/contests/participation/dto/participation.response';
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
    api = await setupApiTest();
    await api.setSetting('contest.banAfterDisqualifications', 2);
    rescores = api.app.get(getQueueToken(CONTEST_RESCORE_QUEUE));
    editorId = (
      await createUserWith(api, 'dq_editor', {
        permissions: ['judge.edit_own_contest'],
      })
    )._id;
    editor = await loginAs(api, editorId);
  });
  afterAll(async () => {
    await api.setSetting('contest.banAfterDisqualifications', 0);
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
    const repeat = await createUserWith(api, 'repeat_cheater', {
      apiTokenHash: 'minted before the ban',
    });
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
      apiTokenHash: null,
    });
    // Ended by the ban itself, before any request could touch it.
    const sessionId = session.cookie.replace('qhhoj_session=', '');
    expect(await api.sessions.get(sessionId)).toBeNull();
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

  it('lifts a cheating ban without activating an account that was inactive before it', async () => {
    const inactive = await createUserWith(api, 'inactive_cheater', {
      isActive: false,
    });
    const rows = await Promise.all(
      [1, 2].map(async () => {
        const contest = await createContest(api, { authors: [editorId] });
        const row = await joinParticipation(api, contest._id, inactive._id);
        return { key: contest.key, id: row._id };
      }),
    );
    for (const row of rows) await disqualify(row.key, row.id, true).expect(201);
    expect((await userOf(inactive._id)).banReason).toBe(
      CONTEST_CHEATING_BAN_REASON,
    );
    await disqualify(rows[0].key, rows[0].id, false).expect(201);
    expect(await userOf(inactive._id)).toMatchObject({
      banReason: null,
      isActive: false,
    });
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

  it('disqualifies many rows at once, reports a row of another contest, and rescores once', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    const other = await createContest(api, { authors: [editorId] });
    const first = await createUserWith(api, 'bulk_a');
    const second = await createUserWith(api, 'bulk_b');
    const live = await joinParticipation(api, contest._id, first._id);
    const already = await joinParticipation(api, contest._id, second._id, {
      isDisqualified: true,
    });
    const stranger = await joinParticipation(api, other._id, first._id);
    const response = await authed(
      api.http().post(contestUrl(contest.key, '/participations/disqualify')),
      editor,
    )
      .send({
        ids: [live._id, already._id, stranger._id, 'not-an-id'],
        disqualified: true,
      })
      .expect(200);
    expect(dataOf<BulkDisqualifyResponse>(response)).toEqual({
      results: [
        { id: live._id, outcome: 'done' },
        { id: already._id, outcome: 'unchanged' },
        { id: stranger._id, outcome: 'failed', reason: 'not_found' },
        { id: 'not-an-id', outcome: 'failed', reason: 'not_found' },
      ],
      done: 1,
      failed: 2,
    });
    const stored = await api.contests.findById(contest._id).lean();
    expect(stored?.bannedUsers.map(uuidStr).sort()).toEqual(
      [first._id, second._id].sort(),
    );
    const untouched = await api.participations.findById(stranger._id).lean();
    expect(untouched?.isDisqualified).toBe(false);
    expect(
      (await rescores.getJobs(['waiting'])).map((job) => job.data.contestId),
    ).toEqual([contest._id]);
  });

  it('searches participants by part of the username, for editors only', async () => {
    const contest = await createContest(api, { authors: [editorId] });
    for (const name of ['search_Alice', 'search_malin', 'search_bob'])
      await joinParticipation(
        api,
        contest._id,
        (await createUserWith(api, name))._id,
      );
    await createUserWith(api, 'search_alina_outside');
    const usernames = async (search: string) => {
      const url = contestUrl(
        contest.key,
        `/participations?search=${encodeURIComponent(search)}`,
      );
      const rows = dataOf<ParticipationResponse[]>(
        await authed(api.http().get(url), editor).expect(200),
      );
      return rows.map((row) => row.user.username).sort();
    };
    expect(await usernames('ALI')).toEqual(['search_Alice', 'search_malin']);
    expect(await usernames('.*')).toEqual([]);
  });
});
