import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import {
  PROBLEM_PURGE_QUEUE,
  PROBLEM_SOLVERS_QUEUE,
  problemPurgeJobId,
} from '@libs/problems';
import type { ProblemPurgeJob, ProblemSolversJob } from '@libs/problems';
import { ContestsRepository } from '../src/modules/contests/core/contests.repository';
import { clearRateLimits, createContest } from './contest-fixtures';
import { softDelete, tombstone } from './deleted-problem-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from problems-editing.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';
  const fieldsOf = ({ body }: { body: unknown }) =>
    (body as { error: { fields: Record<string, string[]> } }).error.fields;

  const issueCodesOf = ({ body }: { body: unknown }) =>
    (body as { error: { issues: { code: string }[] } }).error.issues.map(
      (issue) => issue.code,
    );

  describe('problem create, suggest and edit', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let setterId: string, suggesterId: string;
    let setter: TestSession, admin: TestSession, plain: TestSession;
    let valid: Record<string, unknown>;
    const events: Array<[string, ...unknown[]]> = [];

    beforeAll(async () => {
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
      const adminUser = await createUserWith(api, 'admin', {
        isSuperuser: true,
      });
      const plainUser = await createUserWith(api, 'plain');
      setter = await loginAs(api, setterId);
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
      const response = await authed(
        api.http().patch(`${PROBLEMS}/keep`),
        setter,
      )
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
    it('refuses to create, suggest or clone a problem onto a leftover data directory, keeping its files', async () => {
      const leftover = join(api.problemDataRoot, 'leftover');
      mkdirSync(leftover, { recursive: true });
      writeFileSync(join(leftover, '.data-version'), '7\n');
      await createProblem(api, catalog, { code: 'origin', isPublic: false });
      const attempts = [
        authed(api.http().post(PROBLEMS), setter).send({
          ...valid,
          code: 'leftover',
        }),
        authed(api.http().post(`${PROBLEMS}/suggest`), admin).send({
          ...valid,
          code: 'leftover',
        }),
        authed(api.http().post(`${PROBLEMS}/origin/clone`), admin).send({
          code: 'leftover',
        }),
      ];
      for (const attempt of attempts)
        expect(issueCodesOf(await attempt.expect(400))).toEqual([
          'data_directory_taken',
        ]);
      expect(await api.problems.countDocuments({ code: 'leftover' })).toBe(0);
      expect(readFileSync(join(leftover, '.data-version'), 'utf8')).toBe('7\n');
      rmSync(leftover, { recursive: true, force: true });
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
  });
}

// from problem-lifecycle.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';
  const DELETE_RIGHTS = ['judge.delete_problem', 'judge.edit_own_problem'];

  describe('problem delete, restore and purge-now', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let solvers: Queue<ProblemSolversJob>;
    let purges: Queue<ProblemPurgeJob>;
    const sessions: Record<string, TestSession> = {};
    const ids: Record<string, string> = {};
    let sequence = 0;
    const newUser = async (name: string, extra: object) => {
      ids[name] = (await createUserWith(api, name, extra))._id;
      sessions[name] = await loginAs(api, ids[name]);
    };
    const owned = (extra: object = {}) => {
      sequence += 1;
      return createProblem(api, catalog, {
        code: `lc${sequence}`,
        authors: [ids.owner],
        isPublic: false,
        ...extra,
      });
    };
    const remove = (who: string, code: string, confirmCode: string = code) =>
      authed(api.http().delete(`${PROBLEMS}/${code}`), sessions[who]).send({
        confirmCode,
      });
    const post = (
      who: string,
      code: string,
      action: string,
      body: object = {},
    ) =>
      authed(
        api.http().post(`${PROBLEMS}/${code}/${action}`),
        sessions[who],
      ).send(body);
    const reasons = async () =>
      (await solvers.getJobs(['waiting'])).map((job) => [
        job.data.problemId,
        job.data.reason,
      ]);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      solvers = api.app.get(getQueueToken(PROBLEM_SOLVERS_QUEUE));
      purges = api.app.get(getQueueToken(PROBLEM_PURGE_QUEUE));
      await newUser('owner', { permissions: DELETE_RIGHTS });
      await newUser('author_only', { permissions: ['judge.edit_own_problem'] });
      await newUser('stranger', { permissions: ['judge.delete_problem'] });
      await newUser('root', { isSuperuser: true });
    });
    beforeEach(async () => {
      await clearRateLimits(api);
      await solvers.obliterate({ force: true });
      await purges.obliterate({ force: true });
    });

    it('restores within the grace period, once, and brings the problem back', async () => {
      const problem = await owned({ isPublic: true });
      await post('owner', problem.code, 'restore')
        .expect(409)
        .expect(errorCode('not_deleted'));
      await remove('owner', problem.code).expect(204);
      await post('stranger', problem.code, 'restore').expect(403);
      const hidden = await owned();
      await remove('owner', hidden.code).expect(204);
      await post('stranger', hidden.code, 'restore').expect(404);
      await post('author_only', problem.code, 'restore').expect(403);
      await solvers.obliterate({ force: true });
      await post('owner', problem.code, 'restore').expect(204);
      await api.http().get(`${PROBLEMS}/${problem.code}`).expect(200);
      expect(
        (await api.problems.findById(problem._id).lean())!.deletedAt,
      ).toBeUndefined();
      await waitUntil(async () => (await reasons()).length === 1);
      expect(await reasons()).toEqual([[problem._id, 'restored']]);
      await post('owner', problem.code, 'restore')
        .expect(409)
        .expect(errorCode('not_deleted'));
      await post('owner', 'no_such_code', 'restore').expect(404);
    });

    it('undoes a delete when a contest picked the problem up in between, and counts nothing', async () => {
      const problem = await owned({ isPublic: true });
      const contests = api.app.get(ContestsRepository);
      const check = jest
        .spyOn(contests, 'isProblemInAnyContest')
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      await solvers.obliterate({ force: true });
      await remove('owner', problem.code)
        .expect(409)
        .expect(errorCode('problem_in_contest'));
      check.mockRestore();
      expect(
        (await api.problems.findById(problem._id).lean())!.deletedAt,
      ).toBeUndefined();
      expect(await reasons()).toEqual([]);
    });

    it.each([
      ['update', { name: 'Renamed' }],
      ['updateRules', { name: 'Renamed', rules: 'New rules' }],
    ] as const)(
      'refuses a contest save (%s) that a delete overtook between its problem check and its write, and puts the contest back',
      async (method, edit) => {
        const problem = await owned({ isPublic: true });
        const contest = await createContest(api, { authors: [ids.root] });
        const contests = api.app.get(ContestsRepository);
        const write = contests[method].bind(contests) as (
          ...args: unknown[]
        ) => Promise<unknown>;
        const spy = jest.spyOn(contests, method).mockImplementationOnce((async (
          ...args: unknown[]
        ) => {
          await softDelete(api, problem._id);
          return write(...args);
        }) as never);
        await authed(
          api.http().patch(`/api/internal/contests/${contest.key}`),
          sessions.root,
        )
          .send({ ...edit, problems: [{ problem: problem._id, points: 1 }] })
          .expect(400)
          .expect(errorCode('validation_failed'));
        expect(spy).toHaveBeenCalledTimes(1);
        spy.mockRestore();
        const stored = (await api.contests.findById(contest._id).lean())!;
        expect([stored.name, stored.rules, stored.problems]).toEqual([
          contest.name,
          contest.rules,
          [],
        ]);
        // Revisions only go up: a number never names two rules texts.
        expect(stored.rulesRevision).toBe(
          contest.rulesRevision + ('rules' in edit ? 1 : 0),
        );
        expect(await contests.isProblemInAnyContest(problem._id)).toBe(false);
      },
    );

    it('lets only a superuser queue an immediate purge, of a deleted problem, with the code typed', async () => {
      const problem = await owned();
      await post('owner', problem.code, 'purge-now', {
        confirmCode: problem.code,
      }).expect(403);
      await post('root', problem.code, 'purge-now', {
        confirmCode: problem.code,
      })
        .expect(409)
        .expect(errorCode('not_deleted'));
      await remove('owner', problem.code).expect(204);
      await post('root', problem.code, 'purge-now', {
        confirmCode: 'nope',
      }).expect(400);
      await post('root', problem.code, 'purge-now', {
        confirmCode: problem.code,
      }).expect(202);
      expect((await purges.getJobs(['waiting'])).map((job) => job.id)).toEqual([
        problemPurgeJobId(problem._id),
      ]);
      await post('root', problem.code, 'purge-now', {
        confirmCode: problem.code,
      }).expect(202);
      expect(await purges.getJobs(['waiting'])).toHaveLength(1);
      const purged = await owned();
      await remove('owner', purged.code).expect(204);
      await tombstone(api, purged._id);
      await post('root', purged.code, 'purge-now', { confirmCode: purged.code })
        .expect(409)
        .expect(errorCode('purged'));
    });
  });
}
