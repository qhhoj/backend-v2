import { getModelToken } from '@nestjs/mongoose';
import { generateServiceKey } from '@libs/auth';
import {
  IntegrationClient,
  uuidStr,
  ContestGhost,
  newId,
} from '@libs/database';
import type { Model } from 'mongoose';
import { SyncContestOwnership } from '../src/modules/sync/contests/sync-contest-ownership.service';
import { SyncActsAsService } from '../src/modules/sync/contests/sync-acts-as.service';
import {
  clearRateLimits,
  createContest,
  hoursFromNow,
  joinParticipation,
} from './contest-fixtures';
import { createProblem, createUserWith, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { CONTEST_FINAL_JUDGE_QUEUE, finalJudgeJobId } from '@libs/contests';
import type { ContestFinalJudgeJob } from '@libs/contests';
import type { RankingResponse } from '../src/modules/contests/ranking/dto/ranking.response';
import { SyncParticipantsRepository } from '../src/modules/sync/contests/sync-participants.repository';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from sync-contests.e2e-spec.ts
{
  interface Upsert {
    key: string;
    action: string;
    dryRun: boolean;
    isVisible: boolean;
    participantCount: number;
  }

  describe('sync API: writing contests', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let clients: Model<IntegrationClient>;
    let counter = 0;
    const LOCAL = ['127.0.0.0/8', '::1/128'];
    const makeClient = async (extra: Partial<IntegrationClient> = {}) => {
      counter += 1;
      const actsAs = await createUserWith(api, `syncact${counter}`, {
        permissions: ['judge.add_contest', 'judge.create_private_contest'],
      });
      const { key, hash } = generateServiceKey();
      const client = await clients.create({
        name: `client${counter}`,
        keyHash: hash,
        keyPrefix: key.slice(0, 8),
        scopes: ['contests:write', 'contests:read'],
        allowedCidrs: LOCAL,
        actsAs: actsAs._id,
        createdBy: actsAs._id,
        ...extra,
      });
      return { client, actsAs, bearer: `Bearer ${key}` };
    };
    const newKey = () => `sync_${(counter += 1)}`;
    const payload = (extra: Record<string, unknown> = {}) => ({
      name: 'Round',
      startTime: hoursFromNow(24).toISOString(),
      endTime: hoursFromNow(27).toISOString(),
      problems: [
        { code: 'syncp1', points: 100 },
        { code: 'syncp2', points: 200 },
      ],
      ...extra,
    });
    const put = (bearer: string, key: string, body: object, query = '') =>
      api
        .http()
        .put(`/api/sync/v1/contests/${key}${query}`)
        .set('Authorization', bearer)
        .send(body);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      clients = api.app.get(getModelToken(IntegrationClient.name));
      await createProblem(api, catalog, { code: 'syncp1' });
      await createProblem(api, catalog, { code: 'syncp2' });
      await createProblem(api, catalog, { code: 'syncpriv', isPublic: false });
    });
    beforeEach(() => clearRateLimits(api));

    it('is idempotent: the same request again is "unchanged", a changed one "updated"', async () => {
      const { bearer } = await makeClient();
      const key = newKey();
      const body = payload({ formatName: 'icpc', formatConfig: {} });
      await put(bearer, key, body).expect(200);
      expect(
        dataOf<Upsert>(await put(bearer, key, body).expect(200)).action,
      ).toBe('unchanged');
      expect(
        dataOf<Upsert>(
          await put(bearer, key, { ...body, name: 'Renamed' }).expect(200),
        ).action,
      ).toBe('updated');
      expect(await api.contests.countDocuments({ key })).toBe(1);
      expect((await api.contests.findOne({ key }).lean())?.name).toBe(
        'Renamed',
      );
    });

    it('answers 409 conflict with an issue when a parallel create of the same key wins', async () => {
      const { bearer } = await makeClient();
      const key = newKey();
      await put(bearer, key, payload()).expect(200);
      const ownership = api.app.get(SyncContestOwnership);
      const stale = jest.spyOn(ownership, 'find').mockResolvedValueOnce(null);
      const response = await put(bearer, key, payload({ name: 'Twin' })).expect(
        409,
      );
      stale.mockRestore();
      const { error } = response.body as { error: Record<string, unknown> };
      expect(error).toMatchObject({
        code: 'conflict',
        issues: [{ field: 'key', code: 'key_taken' }],
      });
      expect(await api.contests.countDocuments({ key })).toBe(1);
    });

    it('answers 409 and writes nothing when the contest is published between the check and the write', async () => {
      const { bearer } = await makeClient();
      const key = newKey();
      await put(bearer, key, payload()).expect(200);
      const actsAs = api.app.get(SyncActsAsService);
      const original = actsAs.principalOf.bind(actsAs);
      const racing = jest
        .spyOn(actsAs, 'principalOf')
        .mockImplementationOnce(async (client) => {
          await api.contests.updateOne({ key }, { $set: { isVisible: true } });
          return original(client);
        });
      await put(bearer, key, payload({ name: 'Late' }))
        .expect(409)
        .expect(errorCode('conflict'));
      racing.mockRestore();
      expect((await api.contests.findOne({ key }).lean())?.name).toBe('Round');
    });

    it.each([
      ['isVisible', { isVisible: true }],
      ['isPrivate', { isPrivate: false }],
      [
        'organizations',
        { organizations: ['0190a000-0000-7000-8000-000000000001'] },
      ],
      ['authors', { authors: ['0190a000-0000-7000-8000-000000000001'] }],
      ['privateContestants', { privateContestants: [] }],
      ['accessCode', { accessCode: 'letmein' }],
      ['isRated', { isRated: true }],
      ['managedBy', { managedBy: null }],
    ])('has no way to set %s: the field is refused', async (_name, extra) => {
      const { bearer } = await makeClient();
      const key = newKey();
      await put(bearer, key, payload(extra))
        .expect(400)
        .expect(errorCode('validation_failed'));
      expect(await api.contests.countDocuments({ key })).toBe(0);
    });

    it("answers 403 for a contest it does not own, the same for a person's and another client's, and still creates new keys", async () => {
      const mine = await makeClient();
      const theirs = await makeClient();
      const human = await createContest(api, { key: newKey() });
      const others = newKey();
      await put(theirs.bearer, others, payload()).expect(200);
      const humanAnswer = await put(mine.bearer, human.key, payload())
        .expect(403)
        .expect(errorCode('forbidden'));
      const otherAnswer = await put(mine.bearer, others, payload()).expect(403);
      expect(humanAnswer.body).toEqual(otherAnswer.body);
      expect(
        (await api.contests.findOne({ key: human.key }).lean())?.name,
      ).toBe('Contest');
      expect(
        (await api.contests.findOne({ key: others }).lean())?.managedBy,
      ).toEqual(
        (await clients.findOne({ _id: theirs.client._id }).lean())?._id,
      );
      await put(mine.bearer, newKey(), payload()).expect(200);
    });

    it("answers 404 with one identical body for a missing key, a person's contest and another client's", async () => {
      const mine = await makeClient();
      const theirs = await makeClient();
      const human = await createContest(api, { key: newKey() });
      const others = newKey();
      await put(theirs.bearer, others, payload()).expect(200);
      const read = (key: string) =>
        api
          .http()
          .get(`/api/sync/v1/contests/${key}`)
          .set('Authorization', mine.bearer)
          .expect(404);
      const missing = await read(newKey()).expect(errorCode('not_found'));
      expect((await read(human.key)).body).toEqual(missing.body);
      expect((await read(others)).body).toEqual(missing.body);
    });

    it('freezes everything but participants once a person published the contest or it started', async () => {
      const { bearer } = await makeClient();
      const published = newKey();
      const body = payload();
      await put(bearer, published, body).expect(200);
      await api.contests.updateOne(
        { key: published },
        { $set: { isVisible: true } },
      );
      await put(bearer, published, { ...body, name: 'Sneaky' })
        .expect(409)
        .expect(errorCode('contest_frozen'));
      expect(
        dataOf<Upsert>(await put(bearer, published, body).expect(200)).action,
      ).toBe('unchanged');
      const started = newKey();
      const startTime = hoursFromNow(-1).toISOString();
      await put(
        bearer,
        started,
        payload({ startTime, endTime: hoursFromNow(2).toISOString() }),
      ).expect(200);
      await put(
        bearer,
        started,
        payload({ startTime, endTime: hoursFromNow(5).toISOString() }),
      )
        .expect(409)
        .expect(errorCode('contest_frozen'));
      expect(
        (await api.contests.findOne({ key: published }).lean())?.name,
      ).toBe('Round');
    });

    it('lets the client attach only problems its acting user can see, and does not tell hidden from missing', async () => {
      const { bearer, actsAs } = await makeClient();
      const key = newKey();
      const hidden = await put(
        bearer,
        key,
        payload({ problems: [{ code: 'syncpriv', points: 10 }] }),
      ).expect(400);
      const missing = await put(
        bearer,
        key,
        payload({ problems: [{ code: 'nosuchproblem', points: 10 }] }),
      ).expect(400);
      // One answer for both, so a client cannot probe for hidden problem codes.
      expect(hidden.body).toEqual(missing.body);
      expect(await api.contests.countDocuments({ key })).toBe(0);
      await api.users.updateOne(
        { _id: actsAs._id },
        { $addToSet: { permissions: 'judge.see_private_problem' } },
      );
      await put(
        bearer,
        key,
        payload({ problems: [{ code: 'syncpriv', points: 10 }] }),
      ).expect(200);
    });

    it.each([
      ['loses a permission', { permissions: ['judge.add_contest'] }],
      ['becomes a superuser', { isSuperuser: true }],
      ['is deactivated', { isActive: false }],
    ])(
      'refuses every sync route at once when the acting user %s',
      async (_name, change) => {
        const { bearer, actsAs } = await makeClient();
        const key = newKey();
        const body = payload();
        await put(bearer, key, body).expect(200);
        await api.users.updateOne({ _id: actsAs._id }, { $set: change });
        const route = (path: string) => `/api/sync/v1/contests/${path}`;
        const calls = [
          put(bearer, key, { ...body, name: 'Changed' }),
          put(bearer, newKey(), payload()),
          api.http().get(route(key)),
          api.http().get(route(`${key}/standings`)),
          api
            .http()
            .put(route(`${key}/participants`))
            .send({ usernames: [] }),
          api.http().delete(route(key)),
        ];
        for (const call of calls)
          await call
            .set('Authorization', bearer)
            .expect(403)
            .expect(errorCode('forbidden'));
        expect(await api.contests.findOne({ key }).lean()).toMatchObject({
          name: 'Round',
        });
      },
    );
  });
}

// from sync-contest-lifecycle.e2e-spec.ts
{
  describe('sync API: participants, removal and standings', () => {
    beforeAll(() => api.reset());
    let clients: Model<IntegrationClient>;
    let ghosts: Model<ContestGhost>;
    let finalJudges: Queue<ContestFinalJudgeJob>;
    let problemId: string;
    let counter = 0;
    const makeClient = async (extra: Partial<IntegrationClient> = {}) => {
      counter += 1;
      const actsAs = await createUserWith(api, `lifeact${counter}`, {
        permissions: ['judge.add_contest', 'judge.create_private_contest'],
      });
      const { key, hash } = generateServiceKey();
      const client = await clients.create({
        name: `life${counter}`,
        keyHash: hash,
        keyPrefix: key.slice(0, 8),
        scopes: ['contests:write', 'contests:read'],
        allowedCidrs: ['127.0.0.0/8', '::1/128'],
        actsAs: actsAs._id,
        createdBy: actsAs._id,
        ...extra,
      });
      return { client, bearer: `Bearer ${key}` };
    };
    const body = (extra: Record<string, unknown> = {}) => ({
      name: 'Round',
      startTime: hoursFromNow(24).toISOString(),
      endTime: hoursFromNow(27).toISOString(),
      formatName: 'final_submission',
      problems: [{ code: 'lifep1', points: 100 }],
      ...extra,
    });
    const call = (
      method: 'put' | 'get' | 'delete',
      bearer: string,
      path: string,
    ) =>
      api
        .http()
        [method](`/api/sync/v1/contests/${path}`)
        .set('Authorization', bearer);
    const create = async (
      bearer: string,
      extra: Record<string, unknown> = {},
    ) => {
      const key = `life_${(counter += 1)}`;
      await call('put', bearer, key).send(body(extra)).expect(200);
      return key;
    };
    const stored = async (key: string) =>
      (await api.contests.findOne({ key }).lean())!;
    const results = (score: number, frozenScore: number) => ({
      score,
      cumtime: 0,
      tiebreaker: 0,
      frozenScore,
      frozenCumtime: 0,
      frozenTiebreaker: 0,
      formatData: {},
      frozenFormatData: {},
    });

    beforeAll(async () => {
      const catalog = await seedCatalog(api);
      clients = api.app.get(getModelToken(IntegrationClient.name));
      ghosts = api.app.get(getModelToken(ContestGhost.name));
      finalJudges = api.app.get(getQueueToken(CONTEST_FINAL_JUDGE_QUEUE));
      problemId = (await createProblem(api, catalog, { code: 'lifep1' }))._id;
    });
    beforeEach(() => clearRateLimits(api));

    describe('participants', () => {
      it('replaces the contestant list with the active users found and returns the rest', async () => {
        const { bearer } = await makeClient();
        const key = await create(bearer);
        const alice = await createUserWith(api, `lifealice${counter}`);
        const bob = await createUserWith(api, `lifebob${counter}`);
        await createUserWith(api, `lifeghost${counter}`, { isActive: false });
        const send = (usernames: string[]) =>
          call('put', bearer, `${key}/participants`).send({ usernames });
        const first = dataOf<{ applied: number; unknown: string[] }>(
          await send([
            alice.username.toUpperCase(),
            bob.username,
            `lifeghost${counter}`,
            'nobodyhere',
          ]).expect(200),
        );
        expect(first).toEqual({
          applied: 2,
          unknown: [`lifeghost${counter}`, 'nobodyhere'],
        });
        const contestants = async () =>
          (await stored(key)).privateContestants.map(uuidStr);
        expect((await contestants()).sort()).toEqual(
          [alice._id, bob._id].sort(),
        );
        await send([bob.username]).expect(200);
        expect(await contestants()).toEqual([bob._id]);
        expect(await api.users.countDocuments({ username: 'nobodyhere' })).toBe(
          0,
        );
        const read = await call('get', bearer, key).expect(200);
        expect(
          dataOf<{ participantCount: number }>(read).participantCount,
        ).toBe(1);
      });

      it('works on a published or started contest too, and only on contests the client owns', async () => {
        const mine = await makeClient();
        const theirs = await makeClient();
        const key = await create(mine.bearer);
        await api.contests.updateOne(
          { key },
          { $set: { isVisible: true, startTime: hoursFromNow(-1) } },
        );
        const participants = (bearer: string, contestKey: string) =>
          call('put', bearer, `${contestKey}/participants`);
        await participants(mine.bearer, key)
          .send({ usernames: [] })
          .expect(200);
        const missing = await participants(mine.bearer, 'life_missing')
          .send({ usernames: [] })
          .expect(404)
          .expect(errorCode('not_found'));
        const notMine = await participants(theirs.bearer, key)
          .send({ usernames: [] })
          .expect(404);
        expect(notMine.body).toEqual(missing.body);
        const human = await createContest(api, {
          key: `lifehuman${(counter += 1)}`,
        });
        const person = await participants(mine.bearer, human.key)
          .send({ usernames: [] })
          .expect(404);
        expect(person.body).toEqual(missing.body);
        await participants(mine.bearer, key)
          .send({
            usernames: Array.from(
              { length: 2001 },
              (_user, index) => `u${index}`,
            ),
          })
          .expect(400);
        const readOnly = await makeClient({ scopes: ['contests:read'] });
        await participants(readOnly.bearer, key)
          .send({ usernames: [] })
          .expect(403);
      });
    });

    describe('removal', () => {
      it('deletes a hidden contest that has not started, with its participations and final-judge job', async () => {
        const { bearer } = await makeClient();
        const key = await create(bearer);
        const contest = await stored(key);
        const user = await createUserWith(api, `lifeplayer${counter}`);
        await joinParticipation(api, uuidStr(contest._id), user._id);
        const jobId = finalJudgeJobId(uuidStr(contest._id), contest.endTime);
        expect(await finalJudges.getJob(jobId)).toBeDefined();
        await call('delete', bearer, key).expect(204);
        expect(await api.contests.countDocuments({ key })).toBe(0);
        expect(
          await api.participations.countDocuments({ contest: contest._id }),
        ).toBe(0);
        expect(await finalJudges.getJob(jobId)).toBeUndefined();
        await call('delete', bearer, key).expect(404);
      });

      it('removes the announcements, the public ranking link and the ghosts with the contest, and refuses when anyone submitted', async () => {
        const { bearer } = await makeClient();
        const key = await create(bearer);
        const contest = await stored(key);
        await api.announcements.create({
          contest: contest._id,
          title: 'Welcome',
        });
        await api.rankingLinks.create({
          contest: contest._id,
          token: 'a'.repeat(18),
          regeneratedAt: new Date(),
        });
        await ghosts.create({ contest: contest._id, label: 'Past team' });
        await call('delete', bearer, key).expect(204);
        const byContest = { contest: contest._id };
        expect(await api.announcements.countDocuments(byContest)).toBe(0);
        expect(await api.rankingLinks.countDocuments(byContest)).toBe(0);
        expect(await ghosts.countDocuments(byContest)).toBe(0);
        const kept = await create(bearer);
        const keptId = (await stored(kept))._id;
        await api.contestSubmissions.create({
          submission: newId(),
          participation: newId(),
          contest: keptId,
          problem: problemId,
        });
        await call('delete', bearer, kept)
          .expect(409)
          .expect(errorCode('contest_not_deletable'));
        expect(await api.contests.countDocuments({ key: kept })).toBe(1);
        const stamped = await create(bearer);
        await api.submissions.create({
          user: newId(),
          problem: problemId,
          language: newId(),
          contest: (await stored(stamped))._id,
        });
        await call('delete', bearer, stamped)
          .expect(409)
          .expect(errorCode('contest_not_deletable'));
        expect(await api.contests.countDocuments({ key: stamped })).toBe(1);
      });

      it.each([
        ['a published contest', { isVisible: true }],
        ['a started contest', { startTime: hoursFromNow(-1) }],
      ])('refuses to delete %s', async (_name, change) => {
        const { bearer } = await makeClient();
        const key = await create(bearer);
        await api.contests.updateOne({ key }, { $set: change });
        await call('delete', bearer, key)
          .expect(409)
          .expect(errorCode('contest_not_deletable'));
        expect(await api.contests.countDocuments({ key })).toBe(1);
      });

      it.each([
        ['published', { isVisible: true }],
        ['started', { startTime: hoursFromNow(-1) }],
        ['handed to a person', { managedBy: null }],
      ])(
        'keeps a contest %s between the checks and the delete',
        async (_name, change) => {
          const { client, bearer } = await makeClient();
          const key = await create(bearer);
          const contest = await stored(key);
          await api.announcements.create({
            contest: contest._id,
            title: 'Kept',
          });
          await api.contests.updateOne({ key }, { $set: change });
          const deleted = await api.app
            .get(SyncParticipantsRepository)
            .deleteUnstarted(uuidStr(contest._id), {
              clientId: uuidStr(client._id),
              now: new Date(),
            });
          expect(deleted).toBe(false);
          expect(await api.contests.countDocuments({ key })).toBe(1);
          expect(
            await api.announcements.countDocuments({ contest: contest._id }),
          ).toBe(1);
        },
      );

      it('never deletes a contest it does not own, nor with the read scope only', async () => {
        const mine = await makeClient();
        const theirs = await makeClient();
        const key = await create(theirs.bearer);
        const missing = await call('delete', mine.bearer, 'life_missing')
          .expect(404)
          .expect(errorCode('not_found'));
        expect(
          (await call('delete', mine.bearer, key).expect(404)).body,
        ).toEqual(missing.body);
        const human = await createContest(api, {
          key: `lifeperson${(counter += 1)}`,
          isVisible: false,
          startTime: hoursFromNow(5),
          endTime: hoursFromNow(8),
        });
        expect(
          (await call('delete', mine.bearer, human.key).expect(404)).body,
        ).toEqual(missing.body);
        const readOnly = await makeClient({ scopes: ['contests:read'] });
        await call('delete', readOnly.bearer, key).expect(403);
        expect(
          await api.contests.countDocuments({ key: { $in: [key, human.key] } }),
        ).toBe(2);
      });
    });

    describe('standings', () => {
      const startedContest = (
        bearer: string,
        extra: Record<string, unknown> = {},
      ) =>
        create(bearer, {
          formatName: 'default',
          startTime: hoursFromNow(-2).toISOString(),
          endTime: hoursFromNow(1).toISOString(),
          ...extra,
        });
      const standings = (bearer: string, key: string) =>
        call('get', bearer, `${key}/standings`);

      it('serves the frozen board during a freeze and the live board otherwise', async () => {
        const { bearer } = await makeClient();
        // Only the ICPC-style formats freeze; the freeze covers the whole window here.
        const frozenKey = await startedContest(bearer, {
          formatName: 'icpc',
          frozenLastMinutes: 180,
        });
        const liveKey = await startedContest(bearer, { formatName: 'icpc' });
        const user = await createUserWith(api, `lifeboard${counter}`);
        for (const key of [frozenKey, liveKey])
          await joinParticipation(
            api,
            uuidStr((await stored(key))._id),
            user._id,
            results(300, 100),
          );
        const frozen = dataOf<RankingResponse>(
          await standings(bearer, frozenKey).expect(200),
        );
        expect(frozen.frozen).toBe(true);
        expect(frozen.rows.map((row) => row.score)).toEqual([100]);
        const live = dataOf<RankingResponse>(
          await standings(bearer, liveKey).expect(200),
        );
        expect(live.frozen).toBe(false);
        expect(live.rows.map((row) => row.score)).toEqual([300]);
      });
    });
  });
}
