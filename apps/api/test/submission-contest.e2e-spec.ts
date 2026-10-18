import type { Contest, ContestParticipation } from '@libs/database';
import { ContestsRepository } from '../src/modules/contests/core/contests.repository';
import { ParticipationsRepository } from '../src/modules/contests/core/participations.repository';
import type { SubmissionDetailResponse } from '../src/modules/submissions/core/dto/submission-detail.response';
import type { SubmissionListItemResponse } from '../src/modules/submissions/core/dto/submission-list.response';
import { SubmissionsRepository } from '../src/modules/submissions/core/submissions.repository';
import {
  contestProblem,
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
import { softDelete } from './deleted-problem-fixtures';
import { dataOf, seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe("a submission's contest on its result page and in the lists", () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    users.alice = await createUserWith(api, 'alice', {});
    users.staff = await createUserWith(api, 'staff', {
      permissions: ['judge.view_all_submission'],
    });
    for (const name of Object.keys(users))
      sessions[name] = await loginAs(api, users[name]._id);
  });
  afterAll(() => api.teardown());

  /** `who` null asks as a visitor. */
  const contestOf = async (who: string | null, id: string) => {
    const request = api.http().get(`/api/internal/submissions/${id}`);
    const response = await (who ? authed(request, sessions[who]) : request);
    expect(response.status).toBe(200);
    return dataOf<SubmissionDetailResponse>(response).contest;
  };

  const SUBMISSIONS = '/api/internal/submissions';
  /** The contest block of each row `path` lists, by submission id; `who` null asks as a visitor. */
  const listedBy = async (who: string | null, path: string) => {
    const request = api.http().get(path);
    const response = await (who ? authed(request, sessions[who]) : request);
    expect(response.status).toBe(200);
    return new Map(
      dataOf<SubmissionListItemResponse[]>(response).map((row) => [
        row.id,
        row.contest,
      ]),
    );
  };

  const MINUTE_MS = 60_000;
  /** Alice's submission with 7 of 20 case points in an ended contest (a 100-point partial problem; `stored` is its contest row, null for none), 47.5 minutes after the start, by a live run that joined 30 minutes late; plus one of hers outside the contest. */
  const scene = async (
    code: string,
    {
      stored = 0,
      worth = 100,
      extra = {},
      run = {},
      afterStart = 47.5 * MINUTE_MS,
      awarded,
    }: {
      stored?: number | null;
      /** The submission's own `points`, which the problem's best list ranks on. */
      awarded?: number;
      /** Points of the contest problem. */
      worth?: number;
      extra?: Partial<Contest>;
      run?: Partial<ContestParticipation>;
      afterStart?: number;
    } = {},
  ) => {
    const problem = await createProblem(api, catalog, { code, partial: true });
    const start = hoursFromNow(-3);
    const at = (offset: number) => new Date(start.getTime() + offset);
    const contest = await createContest(api, {
      name: `Round ${code}`,
      startTime: start,
      endTime: hoursFromNow(-1),
      problems: [contestProblem(problem._id, 0, { points: worth })],
      ...extra,
    });
    const participation = await joinParticipation(
      api,
      contest._id,
      users.alice._id,
      { realStart: at(30 * MINUTE_MS), ...run },
    );
    const fields = {
      user: users.alice._id,
      problem: problem._id,
      language: catalog.languages.cpp,
    };
    const inContest = await seedSubmission(api, {
      ...fields,
      contest: contest._id,
      date: at(afterStart),
      result: 'WA',
      casePoints: 7,
      caseTotal: 20,
      ...(awarded === undefined ? {} : { points: awarded }),
    });
    if (stored !== null)
      await api.contestSubmissions.create({
        _id: inContest._id,
        participation: participation._id,
        contest: contest._id,
        problem: problem._id,
        points: stored,
      });
    const outside = await seedSubmission(api, fields);
    return {
      contest,
      problemId: problem._id,
      inContestId: inContest._id,
      outsideId: outside._id,
    };
  };

  it("names the contest and scores the cases in the contest problem's points before the worker stores them", async () => {
    const { contest, inContestId, outsideId } = await scene('block_public');
    expect(await contestOf('alice', inContestId)).toEqual({
      key: contest.key,
      name: 'Round block_public',
      points: 35,
      minute: 47,
    });
    for (const viewer of ['staff', null])
      expect(await contestOf(viewer, inContestId)).toMatchObject({
        points: 35,
        minute: null,
      });
    expect(await contestOf('alice', outsideId)).toBeNull();
  });

  it("counts a virtual run's minute from its join and has none outside the run", async () => {
    const virtual = await scene('block_virtual', {
      run: { virtual: 1, realStart: hoursFromNow(-2) },
      afterStart: 1.5 * 60 * MINUTE_MS,
    });
    expect((await contestOf('alice', virtual.inContestId))?.minute).toBe(30);
    const before = await scene('block_before_join', {
      afterStart: 10 * MINUTE_MS,
      run: { virtual: 1, realStart: hoursFromNow(-2) },
    });
    expect((await contestOf('alice', before.inContestId))?.minute).toBeNull();
  });

  it('keeps the stored points of a problem that left the contest, null without a row', async () => {
    const left = await scene('block_left', {
      stored: 20,
      extra: { problems: [] },
    });
    expect((await contestOf('alice', left.inContestId))?.points).toBe(20);
    const unscored = await scene('block_no_row', {
      stored: null,
      extra: { problems: [] },
    });
    expect((await contestOf('alice', unscored.inContestId))?.points).toBeNull();
  });

  it('keeps the contest of a submission whose problem was deleted', async () => {
    const { contest, problemId, inContestId } = await scene('block_deleted');
    await softDelete(api, problemId);
    expect((await contestOf('alice', inContestId))?.key).toBe(contest.key);
  });

  it('leaves the contest out for a viewer who may not see the contest', async () => {
    const { contest, inContestId } = await scene('block_private', {
      extra: { isPrivate: true, privateContestants: [users.alice._id] },
    });
    expect(await contestOf('staff', inContestId)).toBeNull();
    expect((await contestOf('alice', inContestId))?.key).toBe(contest.key);
  });

  it('leaves out a hidden contest, even for its own participant', async () => {
    const { inContestId } = await scene('block_hidden', {
      extra: { isVisible: false },
    });
    expect(await contestOf('alice', inContestId)).toBeNull();
  });

  describe('on the submission lists', () => {
    it('gives an in-contest row the contest scale of its own contest and a practice row none, as the page does', async () => {
      const { contest, inContestId, outsideId } = await scene('list_public');
      const list = `${SUBMISSIONS}?problem=list_public`;
      const own = await listedBy('alice', list);
      expect(own.get(inContestId)).toEqual({
        key: contest.key,
        name: 'Round list_public',
        points: 35,
        minute: 47,
      });
      expect(own.get(outsideId)).toBeNull();
      for (const viewer of ['staff', null])
        expect((await listedBy(viewer, list)).get(inContestId)).toMatchObject({
          points: 35,
          minute: null,
        });
    });

    it("scores each row on its own contest's scale, and keeps the stored points of a problem that left the contest", async () => {
      const full = await scene('list_scale_a');
      const small = await scene('list_scale_b', { worth: 40 });
      const left = await scene('list_scale_c', {
        extra: { problems: [] },
        stored: 20,
      });
      const rows = await listedBy('alice', `${SUBMISSIONS}?user=alice`);
      expect(rows.get(full.inContestId)?.points).toBe(35);
      expect(rows.get(small.inContestId)?.points).toBe(14);
      expect(rows.get(left.inContestId)?.points).toBe(20);
    });

    it('leaves a contest the viewer may not see out of the row, while the row stays listed', async () => {
      const hidden = await scene('list_hidden', {
        extra: { isVisible: false },
      });
      const secret = await scene('list_private', {
        extra: { isPrivate: true, privateContestants: [users.alice._id] },
      });
      const hiddenRows = await listedBy(
        'alice',
        `${SUBMISSIONS}?problem=list_hidden`,
      );
      expect(hiddenRows.get(hidden.inContestId)).toBeNull();
      const privateList = `${SUBMISSIONS}?problem=list_private`;
      expect(
        (await listedBy('alice', privateList)).get(secret.inContestId)?.key,
      ).toBe(secret.contest.key);
      for (const viewer of ['staff', null])
        expect(
          (await listedBy(viewer, privateList)).get(secret.inContestId),
        ).toBeNull();
    });

    it("matches the page on every page and in the contest's own list", async () => {
      const { contest, inContestId, outsideId } = await scene('list_parity');
      for (const viewer of ['alice', 'staff', null]) {
        const pages = new Map([
          ...(await listedBy(
            viewer,
            `${SUBMISSIONS}?problem=list_parity&pageSize=1&page=1`,
          )),
          ...(await listedBy(
            viewer,
            `${SUBMISSIONS}?problem=list_parity&pageSize=1&page=2`,
          )),
        ]);
        const scoped = await listedBy(
          viewer,
          `/api/internal/contests/${contest.key}/submissions`,
        );
        expect([...pages.keys()].sort()).toEqual(
          [inContestId, outsideId].sort(),
        );
        expect([...scoped.keys()]).toEqual([inContestId]);
        for (const id of pages.keys())
          expect(pages.get(id)).toEqual(await contestOf(viewer, id));
        expect(scoped.get(inContestId)).toEqual(
          await contestOf(viewer, inContestId),
        );
      }
    });

    describe('on the best lists', () => {
      const bestPaths = (code: string, contestKey: string) => [
        `/api/internal/problems/${code}/best-submissions`,
        `/api/internal/contests/${contestKey}/problems/${code}/best-submissions`,
      ];

      it("gives the problem's and the contest's best row the contest block the page gives", async () => {
        const { contest, inContestId } = await scene('list_best', {
          stored: 35,
          awarded: 35,
        });
        for (const path of bestPaths('list_best', contest.key))
          for (const viewer of ['alice', 'staff', null]) {
            const row = (await listedBy(viewer, path)).get(inContestId);
            expect(row).toMatchObject({ key: contest.key, points: 35 });
            expect(row).toEqual(await contestOf(viewer, inContestId));
          }
      });

      it('leaves a contest the viewer may not see out of a best row, while the row stays listed', async () => {
        const hidden = await scene('list_best_hidden', {
          stored: 35,
          awarded: 35,
          extra: { isVisible: false },
        });
        const rows = await listedBy(
          'alice',
          `/api/internal/problems/list_best_hidden/best-submissions`,
        );
        expect(rows.has(hidden.inContestId)).toBe(true);
        expect(rows.get(hidden.inContestId)).toBeNull();
      });
    });

    it('reads the contests of a page in a fixed number of lookups, however many rows it has', async () => {
      await scene('list_batch_a');
      const one = await scene('list_batch_b');
      await scene('list_batch_c');
      const lookups = {
        contests: jest.spyOn(api.app.get(ContestsRepository), 'findByIds'),
        contestPerRow: jest.spyOn(api.app.get(ContestsRepository), 'findById'),
        contestRows: jest.spyOn(
          api.app.get(SubmissionsRepository),
          'contestRows',
        ),
        runs: jest.spyOn(api.app.get(ParticipationsRepository), 'runsByIds'),
      };
      const callsAfter = async (path: string) => {
        Object.values(lookups).forEach((spy) => spy.mockClear());
        const rows = await listedBy('alice', path);
        return {
          rows,
          calls: Object.fromEntries(
            Object.entries(lookups).map(([name, spy]) => [
              name,
              spy.mock.calls.length,
            ]),
          ),
        };
      };
      try {
        const single = await callsAfter(`${SUBMISSIONS}?problem=list_batch_b`);
        const page = await callsAfter(`${SUBMISSIONS}?user=alice&pageSize=100`);
        expect(single.rows.get(one.inContestId)).not.toBeNull();
        expect(
          [...page.rows.values()].filter(Boolean).length,
        ).toBeGreaterThanOrEqual(3);
        expect(page.calls).toEqual(single.calls);
        expect(page.calls.contestPerRow).toBe(0);
      } finally {
        Object.values(lookups).forEach((spy) => spy.mockRestore());
      }
    });
  });
});
