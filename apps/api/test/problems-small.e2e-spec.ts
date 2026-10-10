import { ProblemMetaResponse } from '../src/modules/problems/core/dto/problem-meta.response';
import {
  seedCatalog,
  authed,
  createProblem,
  createUserWith,
  loginAs,
  detailOf,
} from './problem-fixtures';
import { setupApiTest, errorCode } from './setup';
import { newId } from '@libs/database';
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
      });
    });
    it('reflects new catalog rows after a resync', async () => {
      await api.problemTypes.create({
        name: 'graph',
        fullName: 'Graph Theory',
      });
      await api.resyncCatalog();
      expect(
        metaOf(await api.http().get(META).expect(200)).types.map(
          (type) => type.name,
        ),
      ).toEqual(['dp', 'graph', 'uncategorized']);
    });
  });
}

// from problems-random.e2e-spec.ts
{
  const RANDOM = '/api/internal/problems/random';
  const codeOf = ({ body }: { body: unknown }) =>
    (body as { data: { code: string } }).data.code;

  describe('GET /api/internal/problems/random', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let author: TestSession;
    const ORG = newId();

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const authorUser = await createUserWith(api, 'author', {
        permissions: ['judge.edit_own_problem'],
      });
      author = await loginAs(api, authorUser._id);
      await createProblem(api, catalog, { code: 'easy', points: 900 });
      await createProblem(api, catalog, { code: 'easy2', points: 1000 });
      await createProblem(api, catalog, { code: 'hard', points: 3000 });
      await createProblem(api, catalog, {
        code: 'secret',
        isPublic: false,
        authors: [authorUser._id],
        points: 3000,
      });
      await createProblem(api, catalog, {
        code: 'orgonly',
        isOrganizationPrivate: true,
        organizations: [ORG],
        points: 3000,
      });
    });

    it('only returns problems matching the list filters', async () => {
      const seen = new Set<string>();
      for (let attempt = 0; attempt < 30; attempt++)
        seen.add(codeOf(await api.http().get(`${RANDOM}?pointsMax=1000`)));
      expect([...seen].sort()).toEqual(['easy', 'easy2']);
      expect(codeOf(await api.http().get(`${RANDOM}?pointsMin=2000`))).toBe(
        'hard',
      );
    });

    it('never returns what the list would hide from the viewer', async () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        expect(
          codeOf(
            await api.http().get(`${RANDOM}?pointsMin=2000&visibility=all`),
          ),
        ).toBe('hard');
      }
      expect(
        codeOf(
          await authed(
            api.http().get(`${RANDOM}?q=secret&visibility=all`),
            author,
          ),
        ),
      ).toBe('secret');
    });

    it('answers 404 no_problem when nothing matches', async () => {
      await api
        .http()
        .get(`${RANDOM}?pointsMin=9000`)
        .expect(404)
        .expect(errorCode('no_problem'));
      await api
        .http()
        .get(`${RANDOM}?q=secret&visibility=all`)
        .expect(404)
        .expect(errorCode('no_problem'));
    });

    it('rejects invalid filters like the list', async () => {
      await api.http().get(`${RANDOM}?groupId=nope`).expect(400);
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

    it('queues nothing for other fields or an unchanged value', async () => {
      const edited = await problem();
      await authed(api.http().patch(`${PROBLEMS}/${edited.code}`), admin)
        .send({ name: 'Renamed', points: 1000, partial: false })
        .expect(200);
      expect(await queuedProblemIds()).toEqual([]);
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

    it('reads submissions once per page, through an index', async () => {
      const db = api.app.get<Connection>(getConnectionToken()).db!;
      const operations = await profileQueries(db, async () => {
        await statusesFor(viewer);
      });
      const reads = operations.filter(
        ({ collection }) => collection === 'submissions',
      );
      expect(reads).toHaveLength(1);
      expect(reads[0].planSummary).not.toContain('COLLSCAN');
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

      it('gives anonymous viewers every problem for false and none for true', async () => {
        expect(await codesOf(null, 'false')).toEqual(EVERY_CODE);
        expect(await codesOf(null, 'true')).toEqual([]);
      });

      it('is per viewer: another user sees their own solves', async () => {
        const other = await loginAs(
          api,
          (await api.users.findOne({ username: 'other' }))!._id,
        );
        expect(await codesOf(other, 'true')).toEqual(['vs_others']);
      });

      it('rejects a non-boolean value', async () => {
        await authed(
          api.http().get(PROBLEMS).query({ solved: 'maybe' }),
          viewer,
        ).expect(400);
      });

      it('reads the viewer AC submissions through an index', async () => {
        const operations = await profileQueries(api.db, async () => {
          await codesOf(viewer, 'false');
        });
        const reads = operations.filter(
          ({ collection }) => collection === 'submissions',
        );
        for (const read of reads)
          expect(read.planSummary).not.toContain('COLLSCAN');
        // The viewer has two AC rows (solved, short) among six submissions: the filter's read examines only those.
        expect(Math.min(...reads.map(({ docsExamined }) => docsExamined))).toBe(
          2,
        );
      });
    });
  });
}
