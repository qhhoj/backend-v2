import { Logger } from '@nestjs/common';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const fieldsOf = ({ body }: { body: unknown }) =>
  (body as { error: { fields: Record<string, string[]> } }).error.fields;
const waitFor = async (check: () => boolean, timeoutMs = 5000) => {
  const end = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting for the listener');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

describe('problem data and pdf cache follow problem events', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let editor: TestSession;
  const dataDir = (code: string) => join(api.problemDataRoot, code);
  const pdf = (code: string, lang: string) =>
    join(api.pdfCacheRoot, `${code}.${lang}.pdf`);
  const seedFiles = (code: string) => {
    mkdirSync(dataDir(code), { recursive: true });
    writeFileSync(join(dataDir(code), 'init.yml'), 'x: 1\n');
    mkdirSync(api.pdfCacheRoot, { recursive: true });
    writeFileSync(pdf(code, 'en'), '%PDF-');
    writeFileSync(pdf(code, 'vi'), '%PDF-');
  };
  const rename = (from: string, to: string) =>
    authed(api.http().patch(`${PROBLEMS}/${from}`), editor).send({ code: to });

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    await api.problems.init();
    const editorUser = await createUserWith(api, 'editor', {
      permissions: ['judge.edit_own_problem'],
    });
    editor = await loginAs(api, editorUser._id);
    for (const code of [
      'sum',
      'blocked',
      'other',
      'staged',
      'broken',
      'recycled',
    ])
      await createProblem(api, catalog, { code, authors: [editorUser._id] });
  });
  afterAll(() => api.teardown());

  it('moves the data directory and drops the old PDFs on rename', async () => {
    seedFiles('sum');
    await rename('sum', 'sum2').expect(200);
    await waitFor(
      () =>
        existsSync(join(dataDir('sum2'), 'init.yml')) &&
        !existsSync(dataDir('sum')),
    );
    await waitFor(
      () => !existsSync(pdf('sum', 'en')) && !existsSync(pdf('sum', 'vi')),
    );
  });
  it('refuses a rename whose data directory is taken', async () => {
    mkdirSync(dataDir('taken'), { recursive: true });
    writeFileSync(join(dataDir('taken'), 'init.yml'), 'theirs: 1\n');
    seedFiles('blocked');
    expect(fieldsOf(await rename('blocked', 'taken').expect(400))).toEqual({
      code: ['A test data directory for this code already exists.'],
    });
    expect(await api.problems.findOne({ code: 'blocked' })).not.toBeNull();
    expect(existsSync(join(dataDir('blocked'), 'init.yml'))).toBe(true);
    expect(existsSync(pdf('blocked', 'en'))).toBe(true);
    expect(readFileSync(join(dataDir('taken'), 'init.yml'), 'utf8')).toBe(
      'theirs: 1\n',
    );
  });
  it('moves a staged upload along with the directory', async () => {
    seedFiles('staged');
    writeFileSync(join(dataDir('staged'), '.upload-123'), 'partial');
    await rename('staged', 'staged2').expect(200);
    await waitFor(() => existsSync(join(dataDir('staged2'), '.upload-123')));
    expect(existsSync(dataDir('staged'))).toBe(false);
  });
  it('drops the PDFs of the new code too, so a reused code never serves stale ones', async () => {
    seedFiles('recycled');
    writeFileSync(pdf('recycled2', 'en'), '%PDF-');
    await rename('recycled', 'recycled2').expect(200);
    await waitFor(
      () =>
        !existsSync(pdf('recycled', 'en')) &&
        !existsSync(pdf('recycled2', 'en')),
    );
  });
  it('still renames, and logs, when moving the data fails', async () => {
    seedFiles('broken');
    const outside = mkdtempSync(join(tmpdir(), 'qhhoj-outside-'));
    rmSync(dataDir('broken'), { recursive: true });
    symlinkSync(outside, dataDir('broken'));
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      await rename('broken', 'broken2').expect(200);
      await waitFor(() =>
        logged.mock.calls.some(([message]) =>
          String(message).includes('broken'),
        ),
      );
    } finally {
      logged.mockRestore();
    }
    expect(await api.problems.findOne({ code: 'broken2' })).not.toBeNull();
  });
  it('deletes the cached PDFs when the statement changes', async () => {
    seedFiles('other');
    await authed(api.http().patch(`${PROBLEMS}/other`), editor)
      .send({ description: 'New text' })
      .expect(200);
    await waitFor(
      () => !existsSync(pdf('other', 'en')) && !existsSync(pdf('other', 'vi')),
    );
    writeFileSync(pdf('other', 'vi'), '%PDF-');
    await authed(api.http().put(`${PROBLEMS}/other/translations/vi`), editor)
      .send({ name: 'Khác', description: 'Mới' })
      .expect(204);
    await waitFor(() => !existsSync(pdf('other', 'vi')));
    expect(existsSync(join(dataDir('other'), 'init.yml'))).toBe(true);
  });
});
