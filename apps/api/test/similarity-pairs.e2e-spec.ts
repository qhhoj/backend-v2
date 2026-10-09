import { newId, uuidStr } from '@libs/database';
import type { Problem, SimilarityRun } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import type { SimilarityPairDetailResponse } from '../src/modules/similarity/pairs/dto/similarity-pair-detail.response';
import type { SimilarityPairResponse } from '../src/modules/similarity/pairs/dto/similarity-pair.response';
import { contestProblem, createContest } from './contest-fixtures';
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

interface PairPage {
  data: SimilarityPairResponse[];
  meta: { page: number; pageSize: number; total: number };
}

const LIMITS = { minPercent: 50, maxPairs: 2000, maxSubmissions: 3000 };
const SOURCE_LEFT = 'int main() {\n  int total = 0;\n  return total;\n}\n';
const SOURCE_RIGHT =
  '// copied\nint main() {\n  int sum = 0;\n  return sum;\n}\n';

describe('similarity pairs', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let problem: Problem;
  let otherProblem: Problem;
  let privateProblem: Problem;
  let run: SimilarityRun;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const roles: Record<string, string[]> = {
    // Author of both problems and of the contest below.
    editor: [
      'judge.moss_contest',
      'judge.edit_own_problem',
      'judge.edit_own_contest',
    ],
    // The permission and edit rights in general, but nobody's author.
    outsider: [
      'judge.moss_contest',
      'judge.edit_own_problem',
      'judge.edit_own_contest',
    ],
    // Author of the problem, without the permission.
    unpermitted: ['judge.edit_own_problem'],
    // Curator of the contest below, not an author of the private problem.
    curator: ['judge.moss_contest', 'judge.edit_own_contest'],
    // Curator of the contest below and author of the private problem.
    owner: [
      'judge.moss_contest',
      'judge.edit_own_contest',
      'judge.edit_own_problem',
    ],
    ann: [],
    bob: [],
  };
  const get = (
    who: string,
    path: string,
    query: Record<string, unknown> = {},
  ) => authed(api.http().get(path).query(query), sessions[who]);
  const pairsOf = (runId: string) =>
    `/api/internal/similarity/runs/${runId}/pairs`;
  const pairUrl = (pairId: string) =>
    `/api/internal/similarity/pairs/${pairId}`;
  const similaritiesOf = async (query: Record<string, unknown>) =>
    (
      (await get('editor', pairsOf(run._id), query).expect(200))
        .body as PairPage
    ).data.map((pair) => pair.similarity);

  /**
   * `overrides` apply to the pair, `submissionFields` to both its submissions,
   * unless `rightFields` replaces them on the right one.
   */
  const addPair = async (
    similarity: number,
    overrides: Record<string, unknown> = {},
    submissionFields: Record<string, unknown> = {},
    rightFields: Record<string, unknown> = submissionFields,
  ) => {
    const left = await seedSubmission(api, {
      user: users.ann._id,
      problem: problem._id,
      language: catalog.languages.cpp,
      source: SOURCE_LEFT,
      ...submissionFields,
    });
    const right = await seedSubmission(api, {
      user: users.bob._id,
      problem: problem._id,
      language: catalog.languages.cpp,
      source: SOURCE_RIGHT,
      ...rightFields,
    });
    return api.similarityPairs.create({
      run: run._id,
      problem: problem._id,
      language: 'cpp',
      left: { submission: left._id, user: users.ann._id },
      right: { submission: right._id, user: users.bob._id },
      similarity,
      longestFragment: 9,
      totalOverlap: 20,
      fragments: [{ leftStart: 1, leftEnd: 4, rightStart: 2, rightEnd: 5 }],
      ...overrides,
    });
  };

  const seedContestRun = async (
    contestFields: Record<string, unknown> = {},
  ) => {
    const contest = await createContest(api, {
      authors: [users.editor._id],
      problems: [contestProblem(problem._id, 0)],
      ...contestFields,
    });
    return api.similarityRuns.create({
      scope: 'contest',
      scopeKey: `contest:${contest._id}`,
      contest: contest._id,
      requestedBy: users.editor._id,
      status: 'done',
      active: false,
      limits: LIMITS,
    });
  };

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    for (const [name, permissions] of Object.entries(roles)) {
      users[name] = await createUserWith(api, name, { permissions });
      sessions[name] = await loginAs(api, users[name]._id);
    }
    problem = await createProblem(api, catalog, {
      code: 'simpair',
      authors: [users.editor._id, users.unpermitted._id],
    });
    otherProblem = await createProblem(api, catalog, {
      code: 'simother',
      authors: [users.editor._id],
    });
    privateProblem = await createProblem(api, catalog, {
      code: 'simprivate',
      isPublic: false,
      authors: [users.owner._id],
    });
  });
  afterAll(() => api.teardown());
  beforeEach(async () => {
    await api.similarityPairs.deleteMany({});
    await api.similarityRuns.deleteMany({});
    run = await api.similarityRuns.create({
      scope: 'problem',
      scopeKey: `problem:${problem._id}`,
      problem: problem._id,
      requestedBy: users.editor._id,
      status: 'done',
      active: false,
      limits: LIMITS,
    });
  });

  it('answers 401 and 403 before showing anything', async () => {
    const pair = await addPair(0.9);
    await api.http().get(pairsOf(run._id)).expect(401);
    await api.http().get(pairUrl(pair._id)).expect(401);
    await get('unpermitted', pairsOf(run._id))
      .expect(403)
      .expect(errorCode('forbidden'));
    await get('unpermitted', pairUrl(pair._id)).expect(403);
  });

  it('hides the pair list from a viewer who does not edit the scope', async () => {
    await addPair(0.9);
    await get('outsider', pairsOf(run._id))
      .expect(404)
      .expect(errorCode('not_found'));
  });

  it('hides the pair detail and its sources from a viewer who does not edit the scope', async () => {
    const pair = await addPair(0.9);
    await get('outsider', pairUrl(pair._id))
      .expect(404)
      .expect(errorCode('not_found'));
  });

  it('answers 404 for the pair detail of a deleted problem', async () => {
    const pair = await addPair(0.9);
    await get('editor', pairUrl(pair._id)).expect(200);
    await api.problems.updateOne(
      { _id: problem._id },
      { $set: { deletedAt: new Date() } },
    );
    try {
      await get('editor', pairUrl(pair._id))
        .expect(404)
        .expect(errorCode('not_found'));
    } finally {
      await api.problems.updateOne(
        { _id: problem._id },
        { $unset: { deletedAt: '' } },
      );
    }
  });

  it('answers 404 for unknown and malformed ids', async () => {
    await get('editor', pairsOf(newId())).expect(404);
    await get('editor', pairsOf('not-a-uuid')).expect(404);
    await get('editor', pairUrl(newId())).expect(404);
    await get('editor', pairUrl('not-a-uuid')).expect(404);
  });

  it('lists pairs best first, paged, with usernames and the problem code', async () => {
    for (const similarity of [0.55, 0.97, 0.7, 0.81]) await addPair(similarity);
    const first = (
      await get('editor', pairsOf(run._id), { page: 1, pageSize: 3 }).expect(
        200,
      )
    ).body as PairPage;
    expect(first.data.map((pair) => pair.similarity)).toEqual([
      0.97, 0.81, 0.7,
    ]);
    expect(first.meta).toEqual({ page: 1, pageSize: 3, total: 4 });
    expect(first.data[0]).toMatchObject({
      problemCode: 'simpair',
      language: 'cpp',
      fragmentCount: 1,
      left: { username: 'ann', userId: users.ann._id },
      right: { username: 'bob', userId: users.bob._id },
    });
    const second = (
      await get('editor', pairsOf(run._id), { page: 2, pageSize: 3 }).expect(
        200,
      )
    ).body as PairPage;
    expect(second.data.map((pair) => pair.similarity)).toEqual([0.55]);
  });

  it('bounds the page size', async () => {
    await get('editor', pairsOf(run._id), { pageSize: 101 })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('filters by problem, language and minimum similarity', async () => {
    await addPair(0.9);
    await addPair(0.6, { language: 'python' });
    await addPair(0.8, { problem: otherProblem._id });
    expect(await similaritiesOf({ language: 'python' })).toEqual([0.6]);
    expect(await similaritiesOf({ problemId: otherProblem._id })).toEqual([
      0.8,
    ]);
    expect(await similaritiesOf({ minSimilarity: 0.85 })).toEqual([0.9]);
    expect(
      await similaritiesOf({ problemId: problem._id, language: 'cpp' }),
    ).toEqual([0.9]);
    await get('editor', pairsOf(run._id), { minSimilarity: 2 })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('reads a page through the pair indexes without scanning the collection', async () => {
    for (let index = 0; index < 30; index++) await addPair(0.5 + index / 100);
    await api.similarityPairs.syncIndexes();
    const operations = await profileQueries(api.db, async () => {
      await get('editor', pairsOf(run._id), { pageSize: 10 }).expect(200);
      await get('editor', pairsOf(run._id), {
        pageSize: 10,
        language: 'cpp',
        problemId: problem._id,
      }).expect(200);
    });
    const pairReads = operations.filter(
      (operation) => operation.collection === 'similarityPairs',
    );
    expect(pairReads.length).toBeGreaterThan(0);
    for (const operation of pairReads) {
      expect(operation.planSummary).not.toContain('COLLSCAN');
      expect(operation.hasSortStage).toBe(false);
      expect(operation.docsExamined).toBeLessThanOrEqual(40);
    }
  });

  it('shows both sources with their fragment ranges to the scope editor', async () => {
    const pair = await addPair(0.93);
    const detail = dataOf<SimilarityPairDetailResponse>(
      await get('editor', pairUrl(pair._id)).expect(200),
    );
    expect(detail).toMatchObject({
      id: pair._id,
      runId: run._id,
      problemCode: 'simpair',
      similarity: 0.93,
      longestFragment: 9,
      totalOverlap: 20,
      left: { username: 'ann', source: SOURCE_LEFT, result: 'AC' },
      right: { username: 'bob', source: SOURCE_RIGHT },
      fragments: [{ leftStart: 1, leftEnd: 4, rightStart: 2, rightEnd: 5 }],
    });
    expect(detail.left.submissionId).toBe(uuidStr(pair.left.submission));
    // The ranges lie inside the sources they describe.
    const lines = (source: string) => source.trimEnd().split('\n').length;
    for (const fragment of detail.fragments) {
      expect(fragment.leftEnd).toBeLessThanOrEqual(lines(detail.left.source));
      expect(fragment.rightEnd).toBeLessThanOrEqual(lines(detail.right.source));
    }
  });

  it('shows a contest run and its pairs to the contest editor only', async () => {
    const contestRun = await seedContestRun();
    const pair = await addPair(0.9, { run: contestRun._id });
    await get('editor', pairsOf(contestRun._id)).expect(200);
    await get('editor', pairUrl(pair._id)).expect(200);
    await get('outsider', pairsOf(contestRun._id)).expect(404);
    await get('outsider', pairUrl(pair._id)).expect(404);
  });

  describe('in a contest with a private problem', () => {
    let contestRun: SimilarityRun;
    let publicPair: { _id: string };
    let privatePair: { _id: string };
    const idsListedFor = async (who: string) =>
      (
        (await get(who, pairsOf(contestRun._id)).expect(200)).body as PairPage
      ).data.map((pair) => pair.id);

    beforeEach(async () => {
      contestRun = await seedContestRun({
        curators: [users.curator._id, users.owner._id],
        problems: [
          contestProblem(problem._id, 0),
          contestProblem(privateProblem._id, 1),
        ],
      });
      const inContest = { contest: contestRun.contest };
      publicPair = await addPair(0.7, { run: contestRun._id }, inContest);
      privatePair = await addPair(
        0.9,
        { run: contestRun._id, problem: privateProblem._id },
        { ...inContest, problem: privateProblem._id },
      );
    });

    it('leaves the private problem out of the list for a curator who cannot see it', async () => {
      expect(await idsListedFor('curator')).toEqual([publicPair._id]);
    });

    it('hides the private problem pair from a curator who cannot see it', async () => {
      await get('curator', pairUrl(privatePair._id))
        .expect(404)
        .expect(errorCode('not_found'));
      await get('curator', pairUrl(publicPair._id)).expect(200);
    });

    it("shows the private problem pair to the problem's author", async () => {
      expect(await idsListedFor('owner')).toEqual([
        privatePair._id,
        publicPair._id,
      ]);
      await get('owner', pairUrl(privatePair._id)).expect(200);
    });

    it('still hides the private problem pair once both submissions are gone', async () => {
      await api.submissions.deleteMany({});
      await get('curator', pairUrl(privatePair._id)).expect(404);
      await get('owner', pairUrl(privatePair._id)).expect(200);
    });

    it('hides a pair when the source route would hide either side', async () => {
      // A practice submission: being the contest's curator grants nothing on it.
      const inContest = { contest: contestRun.contest };
      const practice = { contest: null };
      const pairs = [
        await addPair(0.8, { run: contestRun._id }, practice, inContest),
        await addPair(0.8, { run: contestRun._id }, inContest, practice),
      ];
      for (const pair of pairs)
        await get('curator', pairUrl(pair._id))
          .expect(404)
          .expect(errorCode('not_found'));
    });

    it('hides sources that the source route would hide', async () => {
      // Submitted outside the contest: being its curator grants nothing on them.
      const practicePair = await addPair(0.8, { run: contestRun._id });
      await get('curator', pairUrl(practicePair._id))
        .expect(404)
        .expect(errorCode('not_found'));
    });
  });

  it('keeps working when a submission or its source has been deleted', async () => {
    const pair = await addPair(0.9);
    await api.submissionSources.deleteOne({
      _id: uuidStr(pair.left.submission),
    });
    const detail = dataOf<SimilarityPairDetailResponse>(
      await get('editor', pairUrl(pair._id)).expect(200),
    );
    expect(detail.left.source).toBe('');
    await api.submissions.deleteOne({ _id: uuidStr(pair.right.submission) });
    const withoutSubmission = dataOf<SimilarityPairDetailResponse>(
      await get('editor', pairUrl(pair._id)).expect(200),
    );
    expect(withoutSubmission.right).toMatchObject({
      date: null,
      result: null,
      points: null,
    });
  });
});
