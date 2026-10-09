import { writeFileSync } from 'node:fs';
import { PDF } from '@libs/problems/testing';
import { PackageCacheService, packageKey } from '@libs/problems';
import type { Problem } from '@libs/database';
import { clearRateLimits } from './contest-fixtures';
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

const PROBLEMS = '/api/internal/problems';

describe('problem package cache and uploads', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let editor: TestSession;
  let editorId: string;
  let cache: PackageCacheService;
  const keyOf = async (code: string) =>
    packageKey(
      (await api.problems.findOne({ code }).select('+data').lean<Problem>())!,
    );
  const cacheNow = async (code: string) => {
    const key = await keyOf(code);
    await cache.write(code, key, (temporary) =>
      Promise.resolve(writeFileSync(temporary, 'zip')),
    );
    return key;
  };
  const upload = (path: string, filename: string, content: Buffer) =>
    authed(api.http().post(`${PROBLEMS}/${path}`), editor).attach(
      'file',
      content,
      {
        filename,
        contentType: 'application/octet-stream',
      },
    );

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const user = await createUserWith(api, 'pkg_editor', {
      permissions: [
        'judge.edit_own_problem',
        'judge.upload_file_statement',
        'judge.upload_problem_material',
      ],
    });
    editorId = user._id;
    editor = await loginAs(api, user._id);
    cache = api.app.get(PackageCacheService);
  });
  afterAll(() => api.teardown());
  beforeEach(() => clearRateLimits(api));

  it('serves a fresh package after a PDF statement is re-uploaded', async () => {
    await createProblem(api, catalog, { code: 'pk_pdf', authors: [editorId] });
    await upload('pk_pdf/statement', 'one.pdf', PDF).expect(201);
    const before = await cacheNow('pk_pdf');
    await upload('pk_pdf/statement', 'two.pdf', PDF).expect(201);
    expect(await cache.has('pk_pdf', before)).toBe(false);
    expect(await keyOf('pk_pdf')).not.toBe(before);
  });

  it('serves a fresh package after a same-named material is replaced', async () => {
    await createProblem(api, catalog, { code: 'pk_mat', authors: [editorId] });
    await upload('pk_mat/material', 'notes.zip', Buffer.from('first')).expect(
      201,
    );
    const before = await cacheNow('pk_mat');
    await upload('pk_mat/material', 'notes.zip', Buffer.from('second')).expect(
      201,
    );
    expect(await keyOf('pk_mat')).toBe(before);
    expect(await cache.has('pk_mat', before)).toBe(false);
  });

  it('keeps the cached package of another problem', async () => {
    await createProblem(api, catalog, {
      code: 'pk_other',
      authors: [editorId],
    });
    await createProblem(api, catalog, {
      code: 'pk_mover',
      authors: [editorId],
    });
    const other = await cacheNow('pk_other');
    await upload('pk_mover/material', 'a.zip', Buffer.from('x')).expect(201);
    expect(await cache.has('pk_other', other)).toBe(true);
  });

  it('refuses the eleventh package request of one user across problems', async () => {
    const codes = ['pu1', 'pu2', 'pu3', 'pu4'];
    for (const code of codes)
      await createProblem(api, catalog, { code, authors: [editorId] });
    for (let count = 0; count < 10; count += 1)
      await authed(
        api.http().post(`${PROBLEMS}/${codes[Math.floor(count / 3)]}/package`),
        editor,
      ).expect((response) => expect([200, 202]).toContain(response.status));
    await authed(api.http().post(`${PROBLEMS}/pu4/package`), editor).expect(
      429,
    );
  });
});
