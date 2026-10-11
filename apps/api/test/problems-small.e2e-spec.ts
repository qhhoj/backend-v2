import { ProblemMetaResponse } from '../src/modules/problems/core/dto/problem-meta.response';
import {
  seedCatalog,
  authed,
  createProblem,
  createUserWith,
  loginAs,
  detailOf,
} from './problem-fixtures';
import { setupApiTest } from './setup';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PROBLEM_RESCORE_QUEUE } from '@libs/judging';
import type { ProblemRescoreJob } from '@libs/judging';
import type { Catalog, TestSession } from './problem-fixtures';
import type { ApiTest } from './setup';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { profileQueries } from '@libs/database/testing';
import type { Submission } from '@libs/database';
import { seedSubmission } from './submission-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from problems-meta.e2e-spec.ts
{
  const META = '/api/internal/problems/meta';
  const metaOf = (response: { body: unknown }) =>
    (response.body as { data: ProblemMetaResponse }).data;

  describe('GET /api/internal/problems/meta', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    beforeAll(async () => {
      catalog = await seedCatalog(api);
    });

    it('lists types, groups, licenses and languages for anonymous users, sorted by display name', async () => {
      const meta = metaOf(await api.http().get(META).expect(200));
      expect(meta.types.map((type) => type.fullName)).toEqual([
        'Dynamic Programming',
        'Uncategorized',
      ]);
      expect(meta.types[1]).toEqual({
        id: catalog.types.uncategorized,
        name: 'uncategorized',
        fullName: 'Uncategorized',
      });
      expect(meta.groups.map((group) => group.fullName)).toEqual([
        'Uncategorized',
        'VOI',
      ]);
      expect(meta.licenses).toEqual([
        {
          id: catalog.licenses.mit,
          key: 'mit',
          name: 'MIT License',
          link: 'https://opensource.org/licenses/MIT',
          display: '',
          icon: '',
        },
      ]);
      expect(meta.languages.map((language) => language.key)).toEqual([
        'CPP17',
        'PY3',
        'TEXT',
      ]);
      expect(meta.languages[0]).toEqual({
        id: catalog.languages.cpp,
        key: 'CPP17',
        name: 'C++17',
        shortName: null,
        commonName: 'C++',
        ace: 'c_cpp',
        extension: 'cpp',
        template: '',
        fileOnly: false,
        fileSizeLimit: 0,
        includeInProblem: true,
        isActive: true,
      });
    });
  });
}

// from problems-rescore.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';

  describe('rescore on problem edits', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let admin: TestSession;
    let queue: Queue<ProblemRescoreJob>;
    let codes = 0;
    const problem = () => {
      codes += 1;
      return createProblem(api, catalog, { code: `rescore${codes}` });
    };
    const queuedProblemIds = async () =>
      (await queue.getJobs(['waiting', 'delayed'])).map(
        (job) => job.data.problemId,
      );

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      admin = await loginAs(
        api,
        (await createUserWith(api, 'admin', { isSuperuser: true }))._id,
      );
      queue = api.app.get<Queue<ProblemRescoreJob>>(
        getQueueToken(PROBLEM_RESCORE_QUEUE),
      );
    });
    beforeEach(() => queue.obliterate({ force: true }));

    it.each([
      [{ points: 1200 }],
      [{ partial: true }],
      [{ isPublic: false }],
      [{ isOrganizationPrivate: true }],
    ])('queues one rescore when %j changes', async (change) => {
      const edited = await problem();
      await authed(api.http().patch(`${PROBLEMS}/${edited.code}`), admin)
        .send(change)
        .expect(200);
      expect(await queuedProblemIds()).toEqual([edited._id]);
    });
  });
}

// from problems-viewer-status.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';
  type ListBody = {
    data: Array<{ code: string; viewerStatus: string | null }>;
  };

  describe('viewerStatus', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let viewer: TestSession;
    const statusesFor = async (who: TestSession | null) => {
      const request = api.http().get(`${PROBLEMS}?pageSize=100`);
      const response = await (who ? authed(request, who) : request).expect(200);
      return Object.fromEntries(
        (response.body as ListBody).data.map((item) => [
          item.code,
          item.viewerStatus,
        ]),
      );
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const viewerId = (await createUserWith(api, 'viewer'))._id;
      const otherId = (await createUserWith(api, 'other'))._id;
      viewer = await loginAs(api, viewerId);
      const submit = async (
        code: string,
        userId: string,
        fields: Partial<Submission>[],
      ) => {
        const problem = await createProblem(api, catalog, { code });
        for (const verdict of fields)
          await seedSubmission(api, {
            user: userId,
            problem: problem._id,
            language: catalog.languages.cpp,
            ...verdict,
          });
      };
      await submit('vs_solved', viewerId, [
        { result: 'WA', casePoints: 0, caseTotal: 2 },
        { result: 'AC', casePoints: 2, caseTotal: 2 },
      ]);
      await submit('vs_short', viewerId, [
        { result: 'AC', casePoints: 1, caseTotal: 2 },
      ]);
      await submit('vs_wrong', viewerId, [
        { result: 'WA', casePoints: 0, caseTotal: 2 },
      ]);
      await submit('vs_compile', viewerId, [{ status: 'CE', result: 'CE' }]);
      await submit('vs_queued', viewerId, [{ status: 'QU', result: null }]);
      await submit('vs_others', otherId, [
        { result: 'AC', casePoints: 2, caseTotal: 2 },
      ]);
      await createProblem(api, catalog, { code: 'vs_untouched' });
    });

    it('marks each listed problem solved, attempted or null for the signed-in viewer', async () =>
      expect(await statusesFor(viewer)).toEqual({
        vs_solved: 'solved',
        vs_short: 'attempted',
        vs_wrong: 'attempted',
        vs_compile: 'attempted',
        vs_queued: 'attempted',
        vs_others: null,
        vs_untouched: null,
      }));

    it('is null for every problem of an anonymous viewer', async () =>
      expect(new Set(Object.values(await statusesFor(null)))).toEqual(
        new Set([null]),
      ));

    it('costs an anonymous viewer no submissions query', async () => {
      const db = api.app.get<Connection>(getConnectionToken()).db!;
      const operations = await profileQueries(db, async () => {
        await statusesFor(null);
      });
      expect(
        operations.filter(({ collection }) => collection === 'submissions'),
      ).toEqual([]);
    });

    it('shows the same status on the detail', async () => {
      const detail = (code: string, who: TestSession | null) => {
        const request = api.http().get(`${PROBLEMS}/${code}`);
        return (who ? authed(request, who) : request).expect(200);
      };
      expect(detailOf(await detail('vs_solved', viewer)).viewerStatus).toBe(
        'solved',
      );
      expect(detailOf(await detail('vs_wrong', viewer)).viewerStatus).toBe(
        'attempted',
      );
      expect(detailOf(await detail('vs_solved', null)).viewerStatus).toBeNull();
    });

    describe('solved filter', () => {
      const codesOf = async (who: TestSession | null, solved: string) => {
        const request = api
          .http()
          .get(PROBLEMS)
          .query({ solved, pageSize: 100 });
        const response = await (who ? authed(request, who) : request).expect(
          200,
        );
        return (response.body as ListBody).data.map((item) => item.code).sort();
      };
      const EVERY_CODE = [
        'vs_compile',
        'vs_others',
        'vs_queued',
        'vs_short',
        'vs_solved',
        'vs_untouched',
        'vs_wrong',
      ];

      it('answers only solved problems for solved=true and everything else for solved=false', async () => {
        expect(await codesOf(viewer, 'true')).toEqual(['vs_solved']);
        expect(await codesOf(viewer, 'false')).toEqual(
          EVERY_CODE.filter((code) => code !== 'vs_solved'),
        );
      });

      it('keeps partial ACs, wrong answers and other users solves out of the solved set', async () => {
        const unsolved = await codesOf(viewer, 'false');
        expect(unsolved).toEqual(
          expect.arrayContaining(['vs_short', 'vs_wrong', 'vs_others']),
        );
        expect(await codesOf(viewer, 'true')).not.toContain('vs_others');
      });
    });
  });
}
