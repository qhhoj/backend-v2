import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { buildZip } from '@libs/problems/testing';
import { ProblemDataResponse } from '../src/modules/problems/dto/problem-data.response';
import {
  authed,
  createProblem,
  createUserWith,
  dataFixture,
  loginAs,
  seedCatalog,
  testCase,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';
const dataOf = ({ body }: { body: unknown }) =>
  (body as { data: ProblemDataResponse }).data;
const fieldsOf = ({ body }: { body: unknown }) =>
  (body as { error: { fields: Record<string, string[]> } }).error.fields;
const tests = (count: number) =>
  Array.from({ length: count }, (_item, index) => [
    { name: `${index + 1}.in`, content: 'in' },
    { name: `${index + 1}.out`, content: 'out' },
  ]).flat();

describe('problem data files', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let editor: TestSession;
  let plain: TestSession;
  let directory: string;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const editorUser = await createUserWith(api, 'editor', {
      permissions: ['judge.edit_own_problem'],
    });
    const plainUser = await createUserWith(api, 'plain');
    editor = await loginAs(api, editorUser._id);
    plain = await loginAs(api, plainUser._id);
    await createProblem(api, catalog, {
      code: 'sum',
      authors: [editorUser._id],
      data: dataFixture({
        cases: [testCase({ input: '1.in', output: '1.out', points: 1 })],
        feedback: 'Input file for case 1 does not exist: 1.in',
      }),
    });
    directory = join(api.problemDataRoot, 'sum');
  });
  afterAll(() => api.teardown());

  const upload = (
    path: string,
    session: TestSession,
    content: Buffer,
    filename: string,
  ) =>
    authed(api.http().post(path), session).attach('file', content, {
      filename,
      contentType: 'application/octet-stream',
    });

  it('stores a valid archive under the problem directory, lists it and recompiles', async () => {
    const data = dataOf(
      await upload(
        `${PROBLEMS}/sum/data/archive`,
        editor,
        buildZip(tests(2)),
        'My Tests (v2).zip',
      ).expect(201),
    );
    expect(data).toMatchObject({
      archive: 'My_Tests_v2.zip',
      feedback: '',
      hasInit: true,
    });
    expect(data.archiveFiles).toEqual(['1.in', '1.out', '2.in', '2.out']);
    expect(readdirSync(directory).sort()).toEqual([
      'My_Tests_v2.zip',
      'init.yml',
    ]);
    expect(
      parse(readFileSync(join(directory, 'init.yml'), 'utf8')),
    ).toMatchObject({ archive: 'My_Tests_v2.zip' });
  });
  it('replaces the previous archive and removes its file', async () => {
    await upload(
      `${PROBLEMS}/sum/data/archive`,
      editor,
      buildZip(tests(1)),
      'tests.zip',
    ).expect(201);
    expect(readdirSync(directory).sort()).toEqual(['init.yml', 'tests.zip']);
  });
  it('refuses a bad archive and leaves the directory clean', async () => {
    const archive = `${PROBLEMS}/sum/data/archive`;
    expect(
      fieldsOf(
        await upload(
          archive,
          editor,
          buildZip([{ name: '../evil', content: 'x' }]),
          'evil.zip',
        ).expect(400),
      ),
    ).toHaveProperty('file');
    expect(
      fieldsOf(
        await upload(
          archive,
          editor,
          buildZip([{ name: 'link', symlink: true, content: '/etc/passwd' }]),
          'link.zip',
        ).expect(400),
      ),
    ).toHaveProperty('file');
    await upload(archive, editor, Buffer.from('not a zip'), 'tests.zip').expect(
      400,
    );
    await upload(archive, editor, buildZip(tests(1)), 'tests.rar').expect(400);
    await upload(archive, editor, Buffer.alloc(0), 'tests.zip').expect(400);
    await authed(api.http().post(archive), editor)
      .field('note', 'x')
      .attach('file', buildZip(tests(1)), 'tests.zip')
      .expect(400);
    await upload(archive, plain, buildZip(tests(1)), 'tests.zip').expect(403);
    expect(readdirSync(directory).sort()).toEqual(['init.yml', 'tests.zip']);
    expect(existsSync(join(api.problemDataRoot, 'evil'))).toBe(false);
  });
  it('accepts an archive larger than the 20 MiB plugin default (per-call limit wins)', async () => {
    const big = buildZip([
      ...tests(1),
      { name: 'big.in', content: Buffer.alloc(21 * 1024 * 1024) },
    ]);
    expect(
      dataOf(
        await upload(
          `${PROBLEMS}/sum/data/archive`,
          editor,
          big,
          'tests.zip',
        ).expect(201),
      ).archiveFiles,
    ).toContain('big.in');
  }, 120000);
  it('uploads sources by kind with extension allow-lists and a 1 MiB cap', async () => {
    const data = dataOf(
      await upload(
        `${PROBLEMS}/sum/data/files/customChecker`,
        editor,
        Buffer.from('int main(){}'),
        'chk.cpp',
      ).expect(201),
    );
    expect(data.customChecker).toBe('chk.cpp');
    expect(readFileSync(join(directory, 'chk.cpp'), 'utf8')).toBe(
      'int main(){}',
    );
    const files = `${PROBLEMS}/sum/data/files`;
    await upload(
      `${files}/customChecker`,
      editor,
      Buffer.from('print(1)'),
      'chk.py',
    ).expect(400);
    await upload(
      `${files}/customHeader`,
      editor,
      Buffer.from('x'),
      'sig.hpp',
    ).expect(400);
    await upload(
      `${files}/customGrader`,
      editor,
      Buffer.alloc(1024 * 1024 + 1),
      'inter.cpp',
    )
      .expect(413)
      .expect(errorCode('file_too_large'));
    await upload(`${files}/archive`, editor, Buffer.from('x'), 'a.zip').expect(
      400,
    );
    await upload(`${files}/magic`, editor, Buffer.from('x'), 'a.cpp').expect(
      400,
    );
    await upload(
      `${files}/generator`,
      editor,
      Buffer.from('int main(){}'),
      'chk.cpp',
    ).expect(400);
    expect(readFileSync(join(directory, 'chk.cpp'), 'utf8')).toBe(
      'int main(){}',
    );
    const bridged = dataOf(
      await authed(api.http().put(`${PROBLEMS}/sum/data`), editor)
        .send({
          checker: 'bridged',
          checkerArgs: { type: 'themis' },
          grader: 'standard',
          cases: [{ type: 'C', input: '1.in', output: '1.out', points: 1 }],
        })
        .expect(200),
    );
    expect(bridged.feedback).toBe('');
    expect(
      parse(readFileSync(join(directory, 'init.yml'), 'utf8')),
    ).toMatchObject({
      checker: {
        name: 'bridged',
        args: { files: 'chk.cpp', lang: 'CPP17', type: 'themis' },
      },
    });
  });
  it('deletes a file, clears the field and recompiles', async () => {
    const data = dataOf(
      await authed(
        api.http().delete(`${PROBLEMS}/sum/data/files/customChecker`),
        editor,
      ).expect(200),
    );
    expect(data.customChecker).toBeNull();
    expect(data.feedback).toBe(
      'A custom checker file is required for the custom checker.',
    );
    expect(existsSync(join(directory, 'chk.cpp'))).toBe(false);
    expect(existsSync(join(directory, 'init.yml'))).toBe(false);
    await authed(
      api.http().delete(`${PROBLEMS}/sum/data/files/customChecker`),
      editor,
    ).expect(200);
  });
  it('downloads data files for editors only, with path containment', async () => {
    const url = `${PROBLEMS}/sum/data/files`;
    const response = await authed(api.http().get(`${url}/tests.zip`), editor)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toBe(
      'attachment; filename="tests.zip"',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    // Buffer.equals: toEqual walks a 21 MiB buffer element by element.
    expect(
      (response.body as Buffer).equals(
        readFileSync(join(directory, 'tests.zip')),
      ),
    ).toBe(true);
    await authed(api.http().get(`${url}/tests.zip`), plain).expect(403);
    await api.http().get(`${url}/tests.zip`).expect(401);
    await authed(api.http().get(`${url}/nope.zip`), editor).expect(404);
    await authed(
      api.http().get(`${url}/..%2F..%2Fetc%2Fpasswd`),
      editor,
    ).expect(404);
    await authed(api.http().get(`${url}/%2e%2e`), editor).expect(404);
    await authed(api.http().get(`${url}/.upload-x`), editor).expect(404);
  });
});
