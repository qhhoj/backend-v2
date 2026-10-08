import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { profileQueries } from '@libs/database/testing';
import type { Submission } from '@libs/database';
import {
  authed,
  createProblem,
  createUserWith,
  detailOf,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { seedSubmission } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';
type ListBody = { data: Array<{ code: string; viewerStatus: string | null }> };

describe('viewerStatus', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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
      const request = api.http().get(PROBLEMS).query({ solved, pageSize: 100 });
      const response = await (who ? authed(request, who) : request).expect(200);
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
      const solvedRead = reads.find(({ planSummary }) =>
        planSummary.includes('{ user: 1, result: 1 }'),
      );
      expect(solvedRead?.docsExamined).toBe(2);
    });
  });
});
