import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { MAX_SOURCE_LENGTH } from '@libs/database';
import type { User } from '@libs/database';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import {
  bridgeCommands,
  clearBridgeCommands,
  dataOf,
} from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const submitTo = (code: string) => `/api/internal/problems/${code}/submit`;

describe('POST /api/internal/problems/:code/submit', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const sessions: Record<string, TestSession> = {};
  const users: Record<string, { _id: string }> = {};
  const body = (extra: object = {}) => ({
    language: catalog.languages.cpp,
    source: 'int main() { return 0; }',
    ...extra,
  });
  const submit = (who: string, code = 'sum', extra: object = {}) =>
    authed(api.http().post(submitTo(code)), sessions[who]).send(body(extra));
  const fieldsOf = ({ body: response }: { body: unknown }) =>
    Object.keys(
      (response as { error: { fields?: object } }).error.fields ?? {},
    );
  const idOf = (response: { body: unknown }) =>
    dataOf<{ id: string }>(response).id;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const roles: Array<[string, Partial<User>]> = [
      ['alice', {}],
      ['spammer', { permissions: ['judge.spam_submission'] }],
      ['editor', { permissions: ['judge.edit_own_problem'] }],
      ['banned', {}],
      ['root', { isSuperuser: true }],
    ];
    for (const [name, extra] of roles) {
      users[name] = await createUserWith(api, name, extra);
      sessions[name] = await loginAs(api, users[name]._id);
    }
    await api.languages.updateOne(
      { _id: catalog.languages.text },
      { fileOnly: true },
    );
    await api.resyncCatalog();
    const sum = await createProblem(api, catalog, {
      code: 'sum',
      authors: [users.editor._id],
      allowedLanguages: [catalog.languages.cpp, catalog.languages.text],
      bannedUsers: [users.banned._id, users.root._id],
    });
    await createProblem(api, catalog, {
      code: 'mirror',
      authors: [users.editor._id],
      mirrorOf: sum._id,
      mirrorRoot: sum._id,
    });
    await createProblem(api, catalog, { code: 'hidden', isPublic: false });
    await api.judges.create([
      {
        name: 'judge-on',
        authKeyHash: 'h',
        online: true,
        problems: ['sum'],
        runtimes: [{ language: 'CPP17', name: 'g++', version: '11.4' }],
      },
      {
        name: 'judge-py-only',
        authKeyHash: 'h',
        online: true,
        problems: ['sum'],
        runtimes: [{ language: 'PY3', name: 'python', version: '3.12' }],
      },
      {
        name: 'judge-other',
        authKeyHash: 'h',
        online: true,
        problems: ['mul'],
      },
      { name: 'judge-off', authKeyHash: 'h', online: false, problems: ['sum'] },
    ]);
  });
  beforeEach(async () => {
    await api.submissions.deleteMany({});
    await clearBridgeCommands(api);
    const redis = api.app.get<Redis>(REDIS);
    const spent = [
      ...(await redis.keys('rate:*')),
      ...(await redis.keys('submit-lock:*')),
    ];
    if (spent.length) await redis.del(...spent);
  });
  afterAll(() => api.teardown());

  it('stores a queued submission with its source and tells the bridge', async () => {
    const id = idOf(await submit('alice').expect(201));
    expect(await api.submissions.findById(id).lean()).toMatchObject({
      status: 'QU',
      priority: 1,
      result: null,
    });
    const stored = (await api.submissions.findById(id))!;
    expect([stored.user, stored.language]).toEqual([
      users.alice._id,
      catalog.languages.cpp,
    ]);
    expect((await api.submissionSources.findById(id).lean())?.source).toBe(
      'int main() { return 0; }',
    );
    expect(await bridgeCommands(api)).toEqual([
      { type: 'judge', submissionIds: [id], judgeName: null, bannedJudges: [] },
    ]);
  });

  it('needs a login and a visible problem', async () => {
    await api.http().post(submitTo('sum')).send(body()).expect(401);
    for (const code of ['hidden', 'nope', 'Bad-Code'])
      await submit('alice', code).expect(404).expect(errorCode('not_found'));
    expect(await api.submissions.countDocuments()).toBe(0);
  });

  it.each([
    [
      'a language the problem does not allow',
      () => ({ language: catalog.languages.python }),
    ],
    [
      'an unknown language',
      () => ({ language: '0192b0e0-0000-7000-8000-000000000009' }),
    ],
  ])('refuses %s on the language field', async (_label, extra) => {
    const response = await submit('alice', 'sum', extra()).expect(400);
    expect(fieldsOf(response)).toEqual(['language']);
  });

  it('sends a file-only language to the file route', async () => {
    const response = await submit('alice', 'sum', {
      language: catalog.languages.text,
    }).expect(400);
    expect(
      (
        response.body as { error: { issues: Array<{ code: string }> } }
      ).error.issues.map((issue) => issue.code),
    ).toEqual(['language_takes_file']);
  });

  it('accepts 1 to 65536 characters of source', async () => {
    for (const source of ['', 'x'.repeat(MAX_SOURCE_LENGTH + 1)])
      expect(
        fieldsOf(await submit('spammer', 'sum', { source }).expect(400)),
      ).toEqual(['source']);
    await submit('spammer', 'sum', {
      source: 'x'.repeat(MAX_SOURCE_LENGTH),
    }).expect(201);
  });

  it('refuses banned users, superusers excepted', async () => {
    await submit('banned').expect(403).expect(errorCode('banned_from_problem'));
    await submit('root').expect(201);
  });

  it('allows two unfinished submissions per user unless the user may spam', async () => {
    await submit('alice').expect(201);
    const second = idOf(await submit('alice').expect(201));
    await submit('alice')
      .expect(429)
      .expect(errorCode('unfinished_submission_limit'));
    await api.submissions.updateOne(
      { _id: second },
      { status: 'D', result: 'AC' },
    );
    await submit('alice').expect(201);
    await api.submissions.updateMany(
      { status: 'QU' },
      { rejudgedDate: new Date() },
    );
    await submit('alice').expect(201);
    for (let attempt = 0; attempt < 3; attempt += 1)
      await submit('spammer').expect(201);
  });

  it('lets only editors pick a judge, and only one that is online with the problem', async () => {
    await submit('alice', 'sum', { judgeId: 'judge-on' }).expect(403);
    for (const judgeId of [
      'judge-off',
      'judge-other',
      'judge-py-only',
      'ghost',
    ])
      expect(
        fieldsOf(await submit('editor', 'sum', { judgeId }).expect(400)),
      ).toEqual(['judgeId']);
    const chosen = idOf(
      await submit('editor', 'sum', { judgeId: 'judge-on' }).expect(201),
    );
    const mirrored = idOf(
      await submit('editor', 'mirror', { judgeId: 'judge-on' }).expect(201),
    );
    expect(await bridgeCommands(api)).toEqual([
      {
        type: 'judge',
        submissionIds: [chosen],
        judgeName: 'judge-on',
        bannedJudges: [],
      },
      {
        type: 'judge',
        submissionIds: [mirrored],
        judgeName: 'judge-on',
        bannedJudges: [],
      },
    ]);
  });

  it('never lets parallel submits slip past the unfinished limit', async () => {
    await submit('alice').expect(201);
    const statuses = (
      await Promise.all(Array.from({ length: 6 }, () => submit('alice')))
    ).map((response) => response.status);
    // Losers get 409 from the lock, or 429 when they take the lock after the winner inserted.
    expect(
      statuses.filter((status) => status !== 409 && status !== 429),
    ).toEqual([201]);
    expect(
      await api.submissions.countDocuments({ user: users.alice._id }),
    ).toBe(2);
  });

  it('counts source length in code points, so astral text within the cap is stored', async () => {
    const id = idOf(
      await submit('spammer', 'sum', { source: '😀'.repeat(40000) }).expect(
        201,
      ),
    );
    expect(
      (await api.submissionSources.findById(id).lean())?.source,
    ).toHaveLength(80000);
    expect(
      fieldsOf(
        await submit('spammer', 'sum', {
          source: '😀'.repeat(MAX_SOURCE_LENGTH + 1),
        }).expect(400),
      ),
    ).toEqual(['source']);
  });

  it('counts variation-selector sequences as code points, never 500', async () => {
    const sequence = '\u2764\uFE0F';
    const atCap = sequence.repeat(MAX_SOURCE_LENGTH / 2);
    const id = idOf(
      await submit('spammer', 'sum', { source: atCap }).expect(201),
    );
    expect((await api.submissionSources.findById(id).lean())?.source).toBe(
      atCap,
    );
    expect(
      fieldsOf(
        await submit('spammer', 'sum', { source: `${atCap}x` }).expect(400),
      ),
    ).toEqual(['source']);
  });

  it('still answers 201 and tells the bridge when releasing the lock fails', async () => {
    const redis = api.app.get<Redis>(REDIS);
    const release = jest
      .spyOn(redis, 'eval')
      .mockRejectedValueOnce(new Error('redis gone'));
    const id = idOf(await submit('alice').expect(201));
    release.mockRestore();
    expect(
      (await bridgeCommands(api)).map(
        (command) => command.type === 'judge' && command.submissionIds,
      ),
    ).toEqual([[id]]);
  });

  it('rate limits each user', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1)
      await submit('spammer').expect(201);
    await submit('spammer').expect(429).expect(errorCode('rate_limited'));
    await submit('alice').expect(201);
  });
});
