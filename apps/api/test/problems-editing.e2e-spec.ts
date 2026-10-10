import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ProblemEvents } from '../src/modules/problems/core/problem.events';
import {
  authed,
  createProblem,
  createUserWith,
  detailOf,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';
const fieldsOf = ({ body }: { body: unknown }) =>
  (body as { error: { fields: Record<string, string[]> } }).error.fields;

const issueCodesOf = ({ body }: { body: unknown }) =>
  (body as { error: { issues: { code: string }[] } }).error.issues.map(
    (issue) => issue.code,
  );

describe('problem create, suggest and edit', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let setterId: string, suggesterId: string;
  let setter: TestSession,
    suggester: TestSession,
    admin: TestSession,
    plain: TestSession;
  let valid: Record<string, unknown>;
  const events: Array<[string, ...unknown[]]> = [];

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    setterId = (
      await createUserWith(api, 'setter', {
        permissions: ['judge.add_problem', 'judge.edit_own_problem'],
      })
    )._id;
    suggesterId = (
      await createUserWith(api, 'suggester', {
        permissions: ['judge.suggest_new_problem', 'judge.edit_own_problem'],
      })
    )._id;
    const adminUser = await createUserWith(api, 'admin', { isSuperuser: true });
    const plainUser = await createUserWith(api, 'plain');
    setter = await loginAs(api, setterId);
    suggester = await loginAs(api, suggesterId);
    admin = await loginAs(api, adminUser._id);
    plain = await loginAs(api, plainUser._id);
    valid = {
      code: 'sum',
      name: 'Sum',
      description: 'Add $a+b$ and $\\foo$.',
      timeLimit: 1,
      memoryLimit: 262144,
      points: 1000,
      typeIds: [catalog.types.dp],
      groupId: catalog.groups.voi,
    };
    const problemEvents = api.app.get(ProblemEvents);
    for (const name of [
      'pointsChanged',
      'publicityChanged',
      'codeRenamed',
      'statementChanged',
    ] as const)
      problemEvents.on(name, (...args: unknown[]) =>
        events.push([name, ...args]),
      );
  });
  afterAll(() => api.teardown());
  beforeEach(() => events.splice(0));

  it('creates a problem for judge.add_problem: curator, date, default languages, rendered statement, revision', async () => {
    const detail = detailOf(
      await authed(api.http().post(PROBLEMS), setter).send(valid).expect(201),
    );
    expect(detail).toMatchObject({
      code: 'sum',
      canEdit: true,
      isPublic: false,
      group: { fullName: 'VOI' },
      language: 'vi',
      translated: true,
    });
    expect(detail.descriptionHtml).toContain('<span class="katex">');
    expect(detail.descriptionHtml).toContain('<span class="math-error"');
    expect(
      detail.allowedLanguages.map((language) => language.key).sort(),
    ).toEqual(['CPP17', 'PY3']);
    const stored = (await api.problems.findOne({ code: 'sum' }))!;
    expect([...stored.curators]).toEqual([setterId]);
    expect(stored.date).toBeInstanceOf(Date);
    expect(
      (await api.revisions.find({ entityId: stored._id })).map((revision) =>
        revision.toJSON(),
      ),
    ).toMatchObject([
      { action: 'create', userId: setterId, comment: 'Created on site' },
    ]);
    await authed(api.http().post(PROBLEMS), plain)
      .send({ ...valid, code: 'other' })
      .expect(403)
      .expect(errorCode('forbidden'));
  });
  it('validates fields, references and disallowed characters', async () => {
    const response = await authed(api.http().post(PROBLEMS), setter)
      .send({
        ...valid,
        code: 'Bad',
        name: 'Quote “x”',
        points: 100,
        typeIds: [],
      })
      .expect(400);
    expect(Object.keys(fieldsOf(response)).sort()).toEqual([
      'code',
      'name',
      'points',
      'typeIds',
    ]);
    expect(
      fieldsOf(
        await authed(api.http().post(PROBLEMS), setter)
          .send({ ...valid, code: 'refs2', groupId: catalog.types.dp })
          .expect(400),
      ),
    ).toHaveProperty('groupId');
    expect(
      fieldsOf(
        await authed(api.http().post(PROBLEMS), setter)
          .send({
            ...valid,
            code: 'refs',
            testers: [setterId, '00000000-0000-7000-8000-000000000000'],
          })
          .expect(400),
      ),
    ).toHaveProperty('testers');
    const taken = await authed(api.http().post(PROBLEMS), setter)
      .send({ ...valid, code: 'sum' })
      .expect(400);
    expect(fieldsOf(taken)).toEqual({ code: ['Problem code is taken.'] });
    expect(issueCodesOf(taken)).toEqual(['code_taken']);
    await authed(api.http().post(PROBLEMS), setter)
      .send({ ...valid, code: 'extra', data: {} })
      .expect(400);
  });
  it('gates isPublic, isFullMarkup, staff fields and high time limits', async () => {
    await authed(api.http().post(PROBLEMS), setter)
      .send({ ...valid, code: 'pub', isPublic: true })
      .expect(403)
      .expect(errorCode('forbidden'));
    await authed(api.http().post(PROBLEMS), setter)
      .send({ ...valid, code: 'pub', isPublic: false })
      .expect(201);
    await authed(api.http().post(PROBLEMS), setter)
      .send({ ...valid, code: 'full', isFullMarkup: true })
      .expect(403);
    await authed(api.http().post(PROBLEMS), setter)
      .send({ ...valid, code: 'staff', authors: [setterId] })
      .expect(403);
    const slow = await authed(api.http().post(PROBLEMS), setter)
      .send({ ...valid, code: 'slow', timeLimit: 10 })
      .expect(400);
    expect(fieldsOf(slow)).toHaveProperty('timeLimit');
    expect(issueCodesOf(slow)).toEqual(['time_limit_too_high']);
    expect(
      fieldsOf(
        await authed(api.http().post(PROBLEMS), setter)
          .send({
            ...valid,
            code: 'slow',
            languageLimits: [
              {
                languageId: catalog.languages.python,
                timeLimit: 6,
                memoryLimit: 1,
              },
            ],
          })
          .expect(400),
      ),
    ).toHaveProperty('timeLimit');
    expect(
      detailOf(
        await authed(api.http().post(PROBLEMS), admin)
          .send({
            ...valid,
            code: 'adminmade',
            isPublic: true,
            authors: [setterId],
            timeLimit: 10,
          })
          .expect(201),
      ),
    ).toMatchObject({
      isPublic: true,
      authors: [{ username: 'setter' }],
      timeLimit: 10,
    });
  });
  it('suggests a problem: suggester set, private, visible to the suggester only', async () => {
    await authed(api.http().post(`${PROBLEMS}/suggest`), setter)
      .send({ ...valid, code: 'idea' })
      .expect(403);
    await authed(api.http().post(`${PROBLEMS}/suggest`), suggester)
      .send({ ...valid, code: 'idea', isPublic: true })
      .expect(403)
      .expect(errorCode('forbidden'));
    await authed(api.http().post(`${PROBLEMS}/suggest`), suggester)
      .send({ ...valid, code: 'idea' })
      .expect(201);
    const stored = (await api.problems.findOne({ code: 'idea' }))!;
    expect(stored.toJSON()).toMatchObject({
      suggester: suggesterId,
      isPublic: false,
      curators: [],
    });
    await authed(api.http().get(`${PROBLEMS}/idea`), suggester).expect(200);
    await authed(api.http().get(`${PROBLEMS}/idea`), plain).expect(404);
  });
  it('edits fields, records a revision diff and emits events', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'edit_me',
      translations: [
        {
          language: 'en',
          name: 'Edit me',
          description: 'x',
          descriptionHtml: '<p>x</p>',
        },
      ],
      isPublic: false,
      authors: [setterId],
      points: 1000,
    });
    const detail = detailOf(
      await authed(api.http().patch(`${PROBLEMS}/edit_me`), setter)
        .send({ name: 'Renamed', points: 1200, description: 'New $x$' })
        .expect(200),
    );
    expect(detail).toMatchObject({
      name: 'Renamed',
      points: 1200,
      language: 'vi',
      translated: true,
    });
    expect(detail.descriptionHtml).toContain('katex');
    const [revision] = await api.revisions.find({
      entityId: problem._id,
      action: 'edit',
    });
    expect(revision.changes).toMatchObject({
      name: { before: 'EDIT_ME', after: 'Renamed' },
      points: { before: 1000, after: 1200 },
    });
    expect(revision.changes).not.toHaveProperty('descriptionHtml');
    expect(events).toEqual([
      ['pointsChanged', problem._id],
      ['statementChanged', problem._id],
    ]);
    await authed(api.http().patch(`${PROBLEMS}/edit_me`), plain).expect(404);
    await createProblem(api, catalog, { code: 'public_one' });
    await authed(api.http().patch(`${PROBLEMS}/public_one`), setter)
      .send({ name: 'x' })
      .expect(403)
      .expect(errorCode('forbidden'));
  });
  it('leaves unsent fields intact on PATCH and rejects out-of-range values', async () => {
    await createProblem(api, catalog, {
      code: 'keep',
      authors: [setterId],
      isPublic: false,
      description: 'Body',
      source: 'Src',
      partial: true,
      languageLimits: [
        {
          languageId: catalog.languages.python,
          timeLimit: 2,
          memoryLimit: 1000,
        },
      ],
    });
    await authed(api.http().patch(`${PROBLEMS}/keep`), setter)
      .send({ name: 'Kept' })
      .expect(200);
    const refused = await authed(api.http().patch(`${PROBLEMS}/keep`), setter)
      .send({ name: null, source: null, licenseId: null })
      .expect(400);
    expect(
      Object.keys(
        (refused.body as { error: { fields: object } }).error.fields,
      ).sort(),
    ).toEqual(['name', 'source']);
    expect(await api.problems.findOne({ code: 'keep' })).toMatchObject({
      name: 'Kept',
      description: 'Body',
      source: 'Src',
      partial: true,
      languageLimits: [{ timeLimit: 2 }],
    });
    const response = await authed(api.http().patch(`${PROBLEMS}/keep`), setter)
      .send({
        code: 'No Good',
        name: 'a“b',
        source: 'x'.repeat(201),
        timeLimit: 0,
        memoryLimit: -1,
        points: 5000,
        description: 'x'.repeat(200_001),
        languageLimits: [
          {
            languageId: catalog.languages.python,
            timeLimit: 61,
            memoryLimit: 1,
          },
        ],
      })
      .expect(400);
    expect(Object.keys(fieldsOf(response)).sort()).toEqual([
      'code',
      'description',
      'languageLimits.0.timeLimit',
      'memoryLimit',
      'name',
      'points',
      'source',
      'timeLimit',
    ]);
    await authed(api.http().patch(`${PROBLEMS}/keep`), setter)
      .send({ name: null })
      .expect(400);
    expect((await api.problems.findOne({ code: 'keep' }))!.name).toBe('Kept');
  });
  it('refuses renaming to a taken code and renames otherwise', async () => {
    await createProblem(api, catalog, {
      code: 'first',
      authors: [setterId],
      isPublic: false,
    });
    await createProblem(api, catalog, {
      code: 'second',
      authors: [setterId],
      isPublic: false,
    });
    expect(
      fieldsOf(
        await authed(api.http().patch(`${PROBLEMS}/second`), setter)
          .send({ code: 'first' })
          .expect(400),
      ),
    ).toEqual({ code: ['Problem code is taken.'] });
    expect(await api.problems.countDocuments({ code: 'second' })).toBe(1);
    await authed(api.http().patch(`${PROBLEMS}/second`), setter)
      .send({ code: 'third' })
      .expect(200);
    await authed(api.http().get(`${PROBLEMS}/second`), setter).expect(404);
    await authed(api.http().get(`${PROBLEMS}/third`), setter).expect(200);
    expect(events).toContainEqual(['codeRenamed', 'second', 'third']);
  });
  it('refuses renaming onto the leftover data directory of a deleted problem, before writing anything', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'rename_src',
      authors: [setterId],
      isPublic: false,
    });
    mkdirSync(join(api.problemDataRoot, 'leftover'), { recursive: true });
    const response = await authed(
      api.http().patch(`${PROBLEMS}/rename_src`),
      setter,
    )
      .send({ code: 'leftover', name: 'Changed' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    expect(fieldsOf(response)).toEqual({
      code: ['A test data directory for this code already exists.'],
    });
    expect(await api.problems.findOne({ code: 'rename_src' })).toMatchObject({
      name: 'RENAME_SRC',
    });
    expect(await api.revisions.countDocuments({ entityId: problem._id })).toBe(
      0,
    );
    expect(events).toEqual([]);
    mkdirSync(join(api.problemDataRoot, 'rename_src'), { recursive: true });
    await authed(api.http().patch(`${PROBLEMS}/rename_src`), setter)
      .send({ code: 'rename_src', name: 'Same code, own directory' })
      .expect(200);
  });
  it('emits statementChanged for a description edit alone, and not for a rescore alone', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'statement_only',
      authors: [setterId],
      isPublic: false,
      description: 'before',
      points: 1000,
    });
    await authed(api.http().patch(`${PROBLEMS}/statement_only`), setter)
      .send({ description: 'after' })
      .expect(200);
    expect(events).toEqual([['statementChanged', problem._id]]);
    events.splice(0);
    await authed(api.http().patch(`${PROBLEMS}/statement_only`), setter)
      .send({ points: 1100 })
      .expect(200);
    expect(events).toEqual([['pointsChanged', problem._id]]);
  });
  it('emits events in order: rename, rescore, publicity, statement', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'ordered',
      isPublic: false,
      suggester: suggesterId,
      description: 'before',
      points: 1000,
    });
    await authed(api.http().patch(`${PROBLEMS}/ordered`), admin)
      .send({
        code: 'ordered_new',
        points: 1100,
        isPublic: true,
        description: 'after',
      })
      .expect(200);
    expect(events).toEqual([
      ['codeRenamed', 'ordered', 'ordered_new'],
      ['pointsChanged', problem._id],
      ['publicityChanged', problem._id, suggesterId],
      ['statementChanged', problem._id],
    ]);
  });
  it('emits publicityChanged with the suggester and re-renders every statement when isFullMarkup flips', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'flip',
      isPublic: false,
      suggester: suggesterId,
      description: 'x',
      translations: [
        {
          language: 'vi',
          name: 'Lật',
          description: '<script>1</script>',
          descriptionHtml: '',
        },
      ],
    });
    await authed(api.http().patch(`${PROBLEMS}/flip`), admin)
      .send({
        isFullMarkup: true,
        description: 'a <script>1</script>',
        isPublic: true,
      })
      .expect(200);
    expect(events).toContainEqual([
      'publicityChanged',
      problem._id,
      suggesterId,
    ]);
    let stored = (await api.problems.findOne({ code: 'flip' }))!;
    expect(stored.descriptionHtml).toContain('<script>');
    expect(stored.translations[0].descriptionHtml).toContain('<script>');
    await authed(api.http().patch(`${PROBLEMS}/flip`), admin)
      .send({ isFullMarkup: false })
      .expect(200);
    const revisions = await api.revisions.find({
      entityId: problem._id,
      action: 'edit',
    });
    expect(
      JSON.stringify(revisions.map((revision) => revision.changes)),
    ).not.toContain('descriptionHtml');
    stored = (await api.problems.findOne({ code: 'flip' }))!;
    expect(stored.descriptionHtml).not.toContain('<script>');
    expect(stored.translations[0].descriptionHtml).not.toContain('<script>');
    await authed(api.http().patch(`${PROBLEMS}/flip`), setter)
      .send({ isPublic: false })
      .expect(403)
      .expect(errorCode('forbidden'));
  });

  it('gates staff fields and isManuallyManaged on edit too', async () => {
    await createProblem(api, catalog, {
      code: 'gated',
      authors: [setterId],
      isPublic: false,
    });
    for (const body of [
      { authors: [suggesterId] },
      { summary: 'x' },
      { isManuallyManaged: true },
    ])
      await authed(api.http().patch(`${PROBLEMS}/gated`), setter)
        .send(body)
        .expect(403)
        .expect(errorCode('forbidden'));
    await authed(api.http().patch(`${PROBLEMS}/gated`), admin)
      .send({ isManuallyManaged: true, summary: 'x' })
      .expect(200);
  });
  it('forbids a suggester to publish or re-author their own suggestion', async () => {
    await createProblem(api, catalog, {
      code: 'mine',
      isPublic: false,
      suggester: suggesterId,
    });
    for (const body of [{ isPublic: true }, { authors: [suggesterId] }])
      await authed(api.http().patch(`${PROBLEMS}/mine`), suggester)
        .send(body)
        .expect(403)
        .expect(errorCode('forbidden'));
    await authed(api.http().patch(`${PROBLEMS}/mine`), suggester)
      .send({ name: 'Mine' })
      .expect(200);
  });
  it('needs judge.problem_full_markup to write the statement of a full-markup problem', async () => {
    await createProblem(api, catalog, {
      code: 'markup',
      authors: [setterId],
      isPublic: false,
      isFullMarkup: true,
      description: 'safe',
    });
    await authed(api.http().patch(`${PROBLEMS}/markup`), setter)
      .send({ description: '<script>1</script>' })
      .expect(403)
      .expect(errorCode('forbidden'));
    expect((await api.problems.findOne({ code: 'markup' }))!.description).toBe(
      'safe',
    );
    await authed(api.http().patch(`${PROBLEMS}/markup`), admin)
      .send({ description: '<script>1</script>' })
      .expect(200);
    expect(
      (await api.problems.findOne({ code: 'markup' }))!.descriptionHtml,
    ).toContain('<script>');
  });
  it('treats reordered or unchanged values as no change: no revision, no events, no gate', async () => {
    const problem = await createProblem(api, catalog, {
      code: 'steady',
      authors: [setterId],
      curators: [setterId, suggesterId],
      isPublic: false,
      description: 'same',
    });
    const revisionCount = () =>
      api.revisions.countDocuments({ entityId: problem._id });
    for (const body of [
      {},
      { description: 'same' },
      { curators: [setterId, suggesterId, setterId] },
    ])
      await authed(api.http().patch(`${PROBLEMS}/steady`), setter)
        .send(body)
        .expect(200);
    expect(events).toEqual([]);
    expect(await revisionCount()).toBe(0);
    await authed(api.http().patch(`${PROBLEMS}/steady`), setter)
      .send({ curators: [suggesterId, setterId] })
      .expect(200);
  });
});
