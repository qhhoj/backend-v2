import { softDelete, tombstone, undelete } from './deleted-problem-fixtures';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { dataOf, seedSubmission } from './submission-fixtures';

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
  problem: { code: string; name: string; isDeleted: boolean } | null;
}

describe('submissions of a deleted problem', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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

  it('names the problem in the list row and marks it deleted', async () => {
    const { problem, mine } = await scenario();
    await softDelete(api, problem._id);
    const rows = dataOf<Row[]>(
      await authed(
        api.http().get(`${SUBMISSIONS}?pageSize=100`),
        sessions.owner,
      ).expect(200),
    );
    expect(rows.find((row) => row.id === mine)!.problem).toEqual({
      code: problem.code,
      name: problem.name,
      isDeleted: true,
    });
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
      isDeleted: true,
    });
  });

  describe('actions on the history (ruling C2)', () => {
    const act = (who: string, id: string, action: string) =>
      authed(api.http().post(`${SUBMISSIONS}/${id}/${action}`), sessions[who]);
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

    it.each(['rejudge', 'reject'])(
      'refuses to %s a submission of a tombstoned problem',
      async (action) => {
        const { problem, mine } = await scenario();
        await softDelete(api, problem._id);
        await tombstone(api, problem._id);
        const response = await act('rejudger', mine, action).expect(409);
        expectProblemDeleted(response);
      },
    );

    it('rejudges again once the problem is restored', async () => {
      const { problem, mine } = await scenario();
      await api.submissions.updateOne({ _id: mine }, { $set: { status: 'D' } });
      await softDelete(api, problem._id);
      await act('rejudger', mine, 'rejudge').expect(409);
      await undelete(api, problem._id);
      expect((await act('rejudger', mine, 'rejudge')).status).toBeLessThan(300);
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

    it("answers 404 to the bulk rejudge of a deleted problem's code", async () => {
      const { problem } = await scenario();
      await softDelete(api, problem._id);
      await authed(api.http().post(`${SUBMISSIONS}/rejudge`), sessions.rejudger)
        .send({ problem: problem.code })
        .expect(404);
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
