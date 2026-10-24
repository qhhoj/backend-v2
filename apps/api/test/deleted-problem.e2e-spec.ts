import { TicketContextService } from '../src/modules/tickets/core/ticket-context.service';

import { softDelete, undelete, tombstone } from './deleted-problem-fixtures';

import {
  authed,
  createProblem,
  seedCatalog,
  createUserWith,
  loginAs,
} from './problem-fixtures';

import type { Catalog, TestSession } from './problem-fixtures';

import { setupApiTest, errorCode } from './setup';

import type { ApiTest } from './setup';

import { createTicket, signedIn, ticketUrl } from './ticket-fixtures';

import type Redis from 'ioredis';

import { REDIS } from '@libs/common';

import { SimilarityRunsRepository } from '../src/modules/similarity/core/similarity-runs.repository';

import type { HomeResponse } from '../src/modules/home/dto/home.response';

import type {
  PpEntryResponse,
  SolvedResponse,
} from '../src/modules/users/pages/dto/user-page.response';

import { dataOf, seedSubmission } from './submission-fixtures';

import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';

import { contestUrl, createContest } from './contest-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from deleted-problem-indirect.e2e-spec.ts
{
  describe('tickets of a deleted problem', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let creator: { id: string; session: TestSession };
    let author: { id: string; session: TestSession };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const filer = await signedIn(api, 'dp_filer');
      const owner = await signedIn(api, 'dp_author');
      creator = { id: filer.user._id, session: filer.session };
      author = { id: owner.user._id, session: owner.session };
    });

    it('shows the linked problem as deleted and keeps the ticket readable by its creator and assignees', async () => {
      const problem = await createProblem(api, catalog, {
        code: 'dp_linked',
        authors: [author.id],
      });
      const ticket = await createTicket(api, {
        creator: creator.id,
        assignees: [author.id],
        problem: problem._id,
      });
      await softDelete(api, problem._id);
      const subjects = await api.app.get(TicketContextService).subjects(
        {
          userId: creator.id,
          username: 'creator',
          isSuperuser: false,
          isStaff: false,
          permissions: new Set(),
          organizationIds: [],
        },
        [ticket],
      );
      expect(subjects.get(ticket._id)?.link).toEqual({
        type: 'problem',
        id: problem._id,
        key: null,
        title: 'Deleted problem',
        url: '',
      });
      await authed(
        api.http().get(ticketUrl(ticket._id)),
        creator.session,
      ).expect(200);
      await authed(
        api.http().get(ticketUrl(ticket._id)),
        author.session,
      ).expect(200);
    });

    it('refuses to file a new ticket on a deleted problem like on an unknown one', async () => {
      const problem = await createProblem(api, catalog, {
        code: 'dp_filing',
        isPublic: true,
      });
      await softDelete(api, problem._id);
      await authed(
        api.http().post(`/api/internal/problems/${problem.code}/tickets`),
        creator.session,
      )
        .send({ title: 'Help', body: 'Where did it go?' })
        .expect(404);
      expect(await api.tickets.countDocuments({ title: 'Help' })).toBe(0);
    });
  });
}

// from deleted-problem-readers.e2e-spec.ts
{
  describe('deleted problems on home, user pages and similarity', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    const solve = (user: string, problem: string) =>
      api.submissions.create({
        user,
        problem,
        language: catalog.languages.cpp,
        status: 'D',
        result: 'AC',
        points: 1000,
        casePoints: 1,
        caseTotal: 1,
      });
    const forgetCachedHome = async () => {
      const redis = api.app.get<Redis>(REDIS);
      const keys = await redis.keys('home:*');
      if (keys.length) await redis.del(...keys);
    };
    const home = async () =>
      dataOf<HomeResponse>(
        await api.http().get('/api/internal/home').expect(200),
      );

    beforeAll(async () => {
      catalog = await seedCatalog(api);
    });

    it('drops a deleted problem from the newest list and the problem count, and brings it back on restore', async () => {
      const keep = await createProblem(api, catalog, { code: 'rd_home_keep' });
      const drop = await createProblem(api, catalog, { code: 'rd_home_drop' });
      await forgetCachedHome();
      const before = await home();
      expect(before.newProblems.map((row) => row.code)).toEqual(
        expect.arrayContaining([keep.code, drop.code]),
      );
      await softDelete(api, drop._id);
      await forgetCachedHome();
      const during = await home();
      expect(during.newProblems.map((row) => row.code)).not.toContain(
        drop.code,
      );
      expect(during.newProblems.map((row) => row.code)).toContain(keep.code);
      expect(during.counts.problems).toBe(before.counts.problems - 1);
      await undelete(api, drop._id);
      await forgetCachedHome();
      expect((await home()).counts.problems).toBe(before.counts.problems);
    });

    it('lists only live problems among those a user solved and in the PP breakdown', async () => {
      const solver = await createUserWith(api, 'rd_solver');
      const keep = await createProblem(api, catalog, {
        code: 'rd_solved_keep',
      });
      const drop = await createProblem(api, catalog, {
        code: 'rd_solved_drop',
      });
      await solve(solver._id, keep._id);
      await solve(solver._id, drop._id);
      await softDelete(api, drop._id);
      const solved = dataOf<SolvedResponse>(
        await api
          .http()
          .get('/api/internal/users/rd_solver/solved')
          .expect(200),
      );
      expect(
        solved.groups.flatMap((group) => group.problems.map((row) => row.code)),
      ).toEqual([keep.code]);
      const breakdown = dataOf<PpEntryResponse[]>(
        await api
          .http()
          .get('/api/internal/users/rd_solver/pp-breakdown')
          .expect(200),
      );
      expect(breakdown.map((entry) => entry.problem.code)).toEqual([keep.code]);
    });

    it('refuses to start a similarity run on a deleted problem and still names it in the run list', async () => {
      const editor = await createUserWith(api, 'rd_sim', {
        permissions: ['judge.moss_contest', 'judge.edit_own_problem'],
      });
      const session = await loginAs(api, editor._id);
      const problem = await createProblem(api, catalog, {
        code: 'rd_sim_problem',
        authors: [editor._id],
      });
      await softDelete(api, problem._id);
      await authed(api.http().post('/api/internal/similarity/runs'), session)
        .send({ problem: problem.code })
        .expect(404);
      const codes = await api.app
        .get(SimilarityRunsRepository)
        .problemCodes([problem._id]);
      expect(codes.get(problem._id)).toBe(problem.code);
    });
  });
}

// from problems-deleted-reads.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';

  describe('soft-deleted problems on the read paths', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let root: TestSession;
    let repository: ProblemsRepository;
    let live: { _id: string; code: string };
    let gone: { _id: string; code: string };
    const codesIn = async (query = '') =>
      dataOf<Array<{ code: string }>>(
        await authed(api.http().get(`${PROBLEMS}${query}`), root).expect(200),
      ).map((row) => row.code);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      root = await loginAs(
        api,
        (await createUserWith(api, 'del_root', { isSuperuser: true }))._id,
      );
      repository = api.app.get(ProblemsRepository);
      live = await createProblem(api, catalog, { code: 'del_live' });
      gone = await createProblem(api, catalog, { code: 'del_gone' });
      await softDelete(api, gone._id);
    });

    it('is absent from the list and the search, even for a superuser', async () => {
      const codes = await codesIn();
      expect(codes).toContain(live.code);
      expect(codes).not.toContain(gone.code);
      expect(await codesIn('?search=del_gone')).toEqual([]);
      expect(await codesIn('?search=del_live')).toEqual([live.code]);
    });

    it('answers 404 to the detail, editorial, PDF, data editor and comment page, and 200 for a live problem', async () => {
      const get = (path: string) => authed(api.http().get(path), root);
      await get(`${PROBLEMS}/${live.code}`).expect(200);
      for (const path of [
        `${PROBLEMS}/${gone.code}`,
        `${PROBLEMS}/${gone.code}/editorial`,
        `${PROBLEMS}/${gone.code}/pdf`,
        `${PROBLEMS}/${gone.code}/data`,
        `/api/internal/comments/pages/problem/${gone.code}`,
      ])
        await get(path).expect(404);
    });

    it('keeps the code reserved: a rename onto it is refused', async () => {
      await authed(api.http().patch(`${PROBLEMS}/${live.code}`), root)
        .send({ code: gone.code })
        .expect(400)
        .expect(errorCode('validation_failed'));
    });

    it('refuses a deleted problem in the contest editor like any unknown problem', async () => {
      const contest = await createContest(api, { authors: [] });
      await authed(api.http().patch(contestUrl(contest.key)), root)
        .send({ problems: [{ problem: gone._id, points: 100 }] })
        .expect(400);
      await authed(api.http().patch(contestUrl(contest.key)), root)
        .send({ problems: [{ problem: live._id, points: 100 }] })
        .expect(200);
    });

    it('marks a problem deleted once, restores it, and refuses to restore a purged one', async () => {
      const problem = await createProblem(api, catalog, { code: 'del_cycle' });
      const actor = (await createUserWith(api, 'del_actor'))._id;
      expect(await repository.markDeleted(problem._id, actor, new Date())).toBe(
        true,
      );
      expect(await repository.markDeleted(problem._id, actor, new Date())).toBe(
        false,
      );
      expect(await repository.findByCode(problem.code)).toBeNull();
      expect(await repository.restore(problem._id)).toBe(true);
      expect(await repository.restore(problem._id)).toBe(false);
      expect((await repository.findByCode(problem.code))?.code).toBe(
        problem.code,
      );
      await tombstone(api, problem._id);
      expect(await repository.restore(problem._id)).toBe(false);
      await undelete(api, problem._id);
    });
  });
}

// from submissions-deleted-problem.e2e-spec.ts
{
  const SUBMISSIONS = '/api/internal/submissions';

  /** The refusal carries its machine code as `error.code` and as `error.issues[0].code`. */
  const expectProblemDeleted = ({ body }: { body: unknown }) => {
    const { error } = body as {
      error: { code: string; issues: { code: string }[] };
    };
    expect(error.code).toBe('problem_deleted');
    expect(error.issues[0].code).toBe('problem_deleted');
  };

  interface Row {
    id: string;
    problem: {
      code: string;
      name: string;
      points: number;
      isDeleted: boolean;
    } | null;
  }

  describe('submissions of a deleted problem', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    const sessions: Record<string, TestSession> = {};
    const ids: Record<string, string> = {};
    let sequence = 0;

    /** A public problem with one submission by the owner and one by another user. */
    const scenario = async () => {
      sequence += 1;
      const problem = await createProblem(api, catalog, {
        code: `sdp${sequence}`,
        name: `Problem ${sequence}`,
      });
      const mine = await seedSubmission(api, {
        user: ids.owner,
        problem: problem._id,
        language: catalog.languages.cpp,
        source: 'int main() { return 1; }',
      });
      const theirs = await seedSubmission(api, {
        user: ids.other,
        problem: problem._id,
        language: catalog.languages.cpp,
      });
      return { problem, mine: mine._id, theirs: theirs._id };
    };
    const listFor = async (who: string) =>
      dataOf<Row[]>(
        await authed(
          api.http().get(`${SUBMISSIONS}?pageSize=100`),
          sessions[who],
        ).expect(200),
      ).map((row) => row.id);
    const get = (who: string, path: string) =>
      authed(api.http().get(`${SUBMISSIONS}/${path}`), sessions[who]);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      for (const [name, extra] of [
        ['owner', {}],
        ['other', {}],
        ['stranger', {}],
        ['staff', { permissions: ['judge.view_all_submission'] }],
        [
          'rejudger',
          {
            permissions: [
              'judge.view_all_submission',
              'judge.edit_own_problem',
              'judge.edit_all_problem',
              'judge.rejudge_submission',
              'judge.reject_submission',
            ],
          },
        ],
      ] as Array<[string, object]>) {
        const user = await createUserWith(api, name, extra);
        ids[name] = user._id;
        sessions[name] = await loginAs(api, user._id);
      }
    });

    it("lists a deleted problem's submissions for the owner and for staff, and for nobody else", async () => {
      const { problem, mine, theirs } = await scenario();
      expect(await listFor('stranger')).toEqual(
        expect.arrayContaining([mine, theirs]),
      );
      await softDelete(api, problem._id);
      const strangerSees = await listFor('stranger');
      expect(strangerSees).not.toContain(mine);
      expect(strangerSees).not.toContain(theirs);
      const ownerSees = await listFor('owner');
      expect(ownerSees).toContain(mine);
      expect(ownerSees).not.toContain(theirs);
      expect(await listFor('staff')).toEqual(
        expect.arrayContaining([mine, theirs]),
      );
      await undelete(api, problem._id);
      expect(await listFor('stranger')).toEqual(
        expect.arrayContaining([mine, theirs]),
      );
    });

    it('shows the detail and the source to the owner and staff without any case detail, and 404s a stranger', async () => {
      const { problem, mine, theirs } = await scenario();
      await softDelete(api, problem._id);
      const detail = dataOf<{
        problem: Row['problem'];
        cases: unknown;
        batches: unknown;
        totalCases: unknown;
      }>(await get('owner', mine).expect(200));
      expect(detail.problem).toMatchObject({
        code: problem.code,
        isDeleted: true,
      });
      expect(detail).toMatchObject({
        cases: null,
        batches: null,
        totalCases: null,
      });
      expect(
        dataOf<{ source: string }>(
          await get('owner', `${mine}/source`).expect(200),
        ).source,
      ).toBe('int main() { return 1; }');
      await get('staff', mine).expect(200);
      await get('staff', theirs).expect(200);
      await get('stranger', mine).expect(404);
      await get('stranger', `${mine}/source`).expect(404);
      await get('owner', theirs).expect(404);
    });

    it('keeps rendering after the purge left only the tombstone', async () => {
      const { problem, mine } = await scenario();
      await softDelete(api, problem._id);
      await tombstone(api, problem._id);
      const detail = dataOf<{ problem: Row['problem'] }>(
        await get('owner', mine).expect(200),
      );
      expect(detail.problem).toEqual({
        code: problem.code,
        name: problem.name,
        points: problem.points,
        isDeleted: true,
      });
    });

    describe('actions on the history (restore and purge rules)', () => {
      const act = (who: string, id: string, action: string) =>
        authed(
          api.http().post(`${SUBMISSIONS}/${id}/${action}`),
          sessions[who],
        );
      const stored = async (id: string) =>
        api.submissions.findById(id).select('+cases').lean();

      it.each(['rejudge', 'reject'])(
        'refuses to %s a submission of a deleted problem and changes nothing',
        async (action) => {
          const { problem, mine } = await scenario();
          await api.submissions.updateOne(
            { _id: mine },
            { $set: { status: 'D', result: 'WA', points: 7 } },
          );
          const before = await stored(mine);
          await softDelete(api, problem._id);
          const response = await act('rejudger', mine, action).expect(409);
          expectProblemDeleted(response);
          expect(await stored(mine)).toEqual(before);
        },
      );

      it('rejudges again once the problem is restored', async () => {
        const { problem, mine } = await scenario();
        await api.submissions.updateOne(
          { _id: mine },
          { $set: { status: 'D' } },
        );
        await softDelete(api, problem._id);
        await act('rejudger', mine, 'rejudge').expect(409);
        await undelete(api, problem._id);
        expect((await act('rejudger', mine, 'rejudge')).status).toBeLessThan(
          300,
        );
      });

      it('lets the owner abort a queued submission of a deleted problem', async () => {
        const { problem, mine } = await scenario();
        await api.submissions.updateOne(
          { _id: mine },
          { $set: { status: 'QU' } },
        );
        await softDelete(api, problem._id);
        expect((await act('owner', mine, 'abort')).status).toBeLessThan(300);
        expect((await stored(mine))!.status).toBe('AB');
      });
    });

    it('still refuses new submissions to a deleted problem', async () => {
      const { problem } = await scenario();
      await softDelete(api, problem._id);
      await authed(
        api.http().post(`/api/internal/problems/${problem.code}/submit`),
        sessions.owner,
      )
        .send({ language: catalog.languages.cpp, source: 'int main() {}' })
        .expect(404);
    });
  });
}
