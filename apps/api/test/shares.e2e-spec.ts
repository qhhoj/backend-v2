import type { Problem, Share, SubmissionCase } from '@libs/database';
import { ACTIVE_SHARE_LIMIT } from '../src/modules/shares/core/rate-limits';
import {
  clearRateLimits,
  contestProblem,
  createContest,
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
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const SHARES = '/api/internal/shares';

interface ShareView {
  source: string;
  hiddenReason: string | null;
  problem: { code: string } | null;
  copy: {
    result: string;
    points: number;
    cases: Array<Record<string, unknown>> | null;
  } | null;
}

const testCase = (position: number, status: 'AC' | 'WA'): SubmissionCase => ({
  position,
  status,
  time: 0.1,
  memory: 1024,
  points: status === 'AC' ? 50 : 0,
  total: 50,
  batch: null,
  feedback: 'expected 42',
  extendedFeedback: '',
  output: 'printed 41',
});

describe('share links', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let ownerId: string;
  let owner: TestSession;
  let reader: TestSession;
  let staff: TestSession;
  let problems = 0;

  const newProblem = (overrides: Partial<Problem> = {}) =>
    createProblem(api, catalog, {
      code: `share${(problems += 1)}`,
      testcaseResultVisibility: 'A',
      ...overrides,
    });
  const submissionOf = async (problemId: string, extra = {}) =>
    seedSubmission(api, {
      user: ownerId,
      problem: problemId,
      language: catalog.languages.cpp,
      result: 'WA',
      points: 50,
      cases: [testCase(1, 'AC'), testCase(2, 'WA')],
      source: 'int main() { return 41; }',
      ...extra,
    });
  const shareSubmission = (session: TestSession, submissionId: string) =>
    authed(api.http().post(`${SHARES}/submissions`), session).send({
      submissionId,
    });
  const paste = (session: TestSession, body: object = {}) =>
    authed(api.http().post(`${SHARES}/pastes`), session).send({
      languageId: catalog.languages.python,
      source: 'print(42)',
      ...body,
    });
  const read = (code: string, session?: TestSession) =>
    session
      ? authed(api.http().get(`${SHARES}/${code}`), session)
      : api.http().get(`${SHARES}/${code}`);
  const sharedCode = async (problemId: string) =>
    dataOf<{ code: string }>(
      await shareSubmission(owner, (await submissionOf(problemId))._id).expect(
        201,
      ),
    ).code;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    ownerId = (await createUserWith(api, 'shareowner'))._id;
    owner = await loginAs(api, ownerId);
    reader = await loginAs(api, (await createUserWith(api, 'sharereader'))._id);
    staff = await loginAs(
      api,
      (
        await createUserWith(api, 'sharestaff', {
          permissions: ['judge.manage_share', 'judge.view_all_submission'],
        })
      )._id,
    );
  });
  beforeEach(() => clearRateLimits(api));
  afterAll(() => api.teardown());

  it('lets only the owner share a submission, even against staff who may read it', async () => {
    const submission = await submissionOf((await newProblem())._id);
    await shareSubmission(staff, submission._id)
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('refuses a problem whose setter shows sources to owners and testers only', async () => {
    const problem = await newProblem({ submissionSourceVisibility: 'O' });
    await shareSubmission(owner, (await submissionOf(problem._id))._id)
      .expect(403)
      .expect(errorCode('hidden'));
  });

  it('refuses a practice submission to a problem a running contest lists', async () => {
    const problem = await newProblem();
    await createContest(api, { problems: [contestProblem(problem._id, 1)] });
    await shareSubmission(owner, (await submissionOf(problem._id))._id)
      .expect(403)
      .expect(errorCode('contest_running'));
  });

  it('closes a shared copy once a running contest lists its problem: 403 to readers, a notice to the owner', async () => {
    const problem = await newProblem();
    const code = await sharedCode(problem._id);
    await read(code).expect(200);
    await createContest(api, { problems: [contestProblem(problem._id, 1)] });
    await read(code).expect(403).expect(errorCode('contest_running'));
    await read(`${code}/raw`).expect(403);
    expect(
      dataOf<ShareView>(await read(code, owner).expect(200)).hiddenReason,
    ).toBe('contest_running');
  });

  it('serves a frozen copy that a later rejudge does not change, without feedback or output, to visitors and unindexed', async () => {
    const problem = await newProblem();
    const submission = await submissionOf(problem._id);
    const { code } = dataOf<{ code: string }>(
      await shareSubmission(owner, submission._id).expect(201),
    );
    await api.submissions.updateOne(
      { _id: submission._id },
      {
        result: 'AC',
        points: 100,
        cases: [testCase(1, 'AC'), testCase(2, 'AC')],
      },
    );
    const response = await read(code).expect(200);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
    const view = dataOf<ShareView>(response);
    expect(view).toMatchObject({
      source: 'int main() { return 41; }',
      problem: { code: problem.code },
      copy: { result: 'WA', points: 50 },
    });
    expect(view.copy!.cases!.map((testCase) => testCase.status)).toEqual([
      'AC',
      'WA',
    ]);
    const stored = await api.shares.findOne({ code }).lean<Share>();
    expect(JSON.stringify(stored)).not.toMatch(/expected 42|printed 41/);
    const raw = await read(`${code}/download`).expect(200);
    expect(raw.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(raw.headers['content-disposition']).toBe(
      `attachment; filename="${code}.cpp"`,
    );
  });

  it('sets the expiry from the chosen lifetime, expires by a TTL index, and answers 404 once past it', async () => {
    const before = Date.now();
    const { code } = dataOf<{ code: string }>(
      await paste(owner, { expiry: '1d' }).expect(201),
    );
    const stored = await api.shares.findOne({ code }).lean<Share>();
    const lifetimeMs = stored!.expiresAt!.getTime() - before;
    expect(lifetimeMs).toBeGreaterThanOrEqual(86_400_000);
    expect(lifetimeMs).toBeLessThan(86_400_000 + 60_000);
    expect(await api.shares.collection.indexes()).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    );
    await api.shares.updateOne(
      { code },
      { expiresAt: new Date(Date.now() - 1000) },
    );
    await read(code).expect(404);
  });

  it(`refuses a new share at ${ACTIVE_SHARE_LIMIT} unexpired ones, expired ones not counted`, async () => {
    const userId = (await createUserWith(api, 'sharefull'))._id;
    const full = await loginAs(api, userId);
    const row = (index: number, expiresAt: Date | null) => ({
      code: `full${index}`,
      kind: 'paste',
      createdBy: userId,
      language: {
        id: catalog.languages.python,
        key: 'PY3',
        name: 'Python 3',
        extension: 'py',
      },
      source: 'x',
      expiresAt,
    });
    await api.shares.insertMany([
      ...Array.from({ length: ACTIVE_SHARE_LIMIT - 1 }, (_unused, index) =>
        row(index, null),
      ),
      row(ACTIVE_SHARE_LIMIT, new Date(Date.now() - 1000)),
    ]);
    await paste(full).expect(201);
    await paste(full)
      .expect(409)
      .expect(issueCodes(['share_limit']));
  });

  it("takes a link down for everyone until staff restore it, logs both, and hides a banned author's links", async () => {
    const { code } = dataOf<{ code: string }>(await paste(owner).expect(201));
    await authed(api.http().post(`${SHARES}/${code}/takedown`), reader)
      .send({ reason: 'spam' })
      .expect(403);
    await authed(api.http().post(`${SHARES}/${code}/takedown`), staff)
      .send({ reason: 'spam' })
      .expect(204);
    await read(code).expect(404);
    await read(code, owner).expect(404);
    await authed(api.http().post(`${SHARES}/${code}/restore`), staff).expect(
      204,
    );
    await read(code).expect(200);
    const share = await api.shares.findOne({ code }).lean<Share>();
    expect(
      (
        await api.revisions
          .find({ entity: 'share', entityId: share!._id })
          .sort({ _id: 1 })
          .lean()
      ).map((revision) => revision.action),
    ).toEqual(['takedown', 'restore']);
    await api.users.updateOne({ _id: ownerId }, { banReason: 'abuse' });
    await read(code).expect(404);
    await api.users.updateOne({ _id: ownerId }, { banReason: null });
  });
});
