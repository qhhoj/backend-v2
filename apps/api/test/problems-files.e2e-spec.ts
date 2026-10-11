import {
  existsSync,
  readdirSync,
  utimesSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { Worker } from 'bullmq';
import type { Queue } from 'bullmq';
import {
  POLYGON_ERROR_PREFIX,
  POLYGON_QUEUE,
  SOURCE_CHECK_QUEUE,
  SVG_MAX_BYTES,
  PDF_QUEUE,
  PdfCacheService,
  pdfJobId,
  listZipEntries,
} from '@libs/problems';
import type {
  PolygonImportJob,
  PdfRenderJob,
  SourceCheckJob,
} from '@libs/problems';
import { buildZip, PDF, PNG, SVG_WITH_SCRIPT } from '@libs/problems/testing';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
  dataFixture,
  testCase,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { IMPORT_LIMIT } from '../src/modules/problems/core/rate-limits';
import { softDelete, tombstone } from './deleted-problem-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { parse } from 'yaml';
import { ProblemDataResponse } from '../src/modules/problems/data/dto/problem-data.response';
import { ProblemsRepository } from '../src/modules/problems/core/problems.repository';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from problems-imports.e2e-spec.ts
{
  const IMPORTS = '/api/internal/problems/imports';
  const UNKNOWN_ID = '0192b0e0-0000-7000-8000-000000000000';
  const PACKAGE = buildZip([
    { name: 'problem.xml', content: '<problem/>' },
    { name: 'tests/01', content: '1' },
  ]);
  const jobIdOf = ({ body }: { body: unknown }) =>
    (body as { data: { jobId: string } }).data.jobId;
  const fieldsOf = ({ body }: { body: unknown }) =>
    (body as { error: { fields: Record<string, string[]> } }).error.fields;
  const issuesOf = ({ body }: { body: unknown }) =>
    (body as { error: { issues: { field: string; code: string }[] } }).error
      .issues;
  interface Status {
    id: string;
    state: string;
    result: unknown;
    error: string | null;
  }

  describe('Polygon import routes', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let importer: TestSession, plain: TestSession, admin: TestSession;
    let creator: TestSession, otherImporter: TestSession;
    let importerId: string, creatorId: string;
    let queue: Queue<PolygonImportJob>;

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      queue = api.app.get(getQueueToken(POLYGON_QUEUE));
      importerId = (
        await createUserWith(api, 'importer', {
          permissions: [
            'judge.import_polygon_package',
            'judge.edit_own_problem',
          ],
        })
      )._id;
      importer = await loginAs(api, importerId);
      creatorId = (
        await createUserWith(api, 'creator', {
          permissions: ['judge.import_polygon_package', 'judge.add_problem'],
        })
      )._id;
      creator = await loginAs(api, creatorId);
      otherImporter = await loginAs(
        api,
        (
          await createUserWith(api, 'other', {
            permissions: ['judge.import_polygon_package'],
          })
        )._id,
      );
      plain = await loginAs(api, (await createUserWith(api, 'plain'))._id);
      admin = await loginAs(
        api,
        (await createUserWith(api, 'admin', { isSuperuser: true }))._id,
      );
      await createProblem(api, catalog, {
        code: 'mine',
        authors: [importerId],
        dataVersion: 3,
      });
      await createProblem(api, catalog, { code: 'theirs' });
      await createProblem(api, catalog, {
        code: 'fancy',
        authors: [importerId],
        isFullMarkup: true,
      });
      await createProblem(api, catalog, {
        code: 'managed',
        authors: [importerId],
        isManuallyManaged: true,
      });
    });

    const importsDirectory = () => join(api.problemDataRoot, '.imports');
    const storedPackages = () => readdirSync(importsDirectory());
    const upload = (
      query: string,
      session: TestSession,
      content: Buffer = PACKAGE,
    ) =>
      authed(api.http().post(`${IMPORTS}?${query}`), session).attach(
        'file',
        content,
        { filename: 'package.zip', contentType: 'application/zip' },
      );
    const statusOf = (jobId: string, session: TestSession) =>
      authed(api.http().get(`${IMPORTS}/${jobId}`), session);
    /** A stand-in worker that fails every job it takes, with the reason chosen by the problem code. */
    const failAllJobs = async (reasonOf: (code: string) => string) => {
      const connection = (await queue.client).duplicate({
        maxRetriesPerRequest: null,
      });
      const worker = new Worker<PolygonImportJob>(
        POLYGON_QUEUE,
        (job) => Promise.reject(new Error(reasonOf(job.data.code))),
        {
          connection,
          prefix: queue.opts.prefix,
        },
      );
      await new Promise<void>((resolve) =>
        worker.on('drained', () => resolve()),
      );
      await worker.close();
      await connection.quit();
    };

    it('stores the package and enqueues a create job with only the given catalog fields', async () => {
      const jobId = jobIdOf(
        await upload(
          `code=newsum&statementLanguages=vietnamese=vi&mainStatementLanguage=english&appendMainSolution=true&points=900&groupId=${catalog.groups.voi}`,
          creator,
        ).expect(202),
      );
      const job = await queue.getJob(jobId);
      expect(job?.data).toEqual({
        requesterId: creatorId,
        code: 'newsum',
        mode: 'create',
        curators: [creatorId],
        groupId: catalog.groups.voi,
        points: 900,
        isFullMarkup: false,
        mainStatementLanguage: 'english',
        statementLanguages: { vietnamese: 'vi' },
        tutorialLanguage: null,
        ignoreZeroPointBatches: false,
        ignoreZeroPointCases: false,
        appendMainSolution: true,
        maxCases: 300,
      });
      expect(existsSync(join(importsDirectory(), `${jobId}.zip`))).toBe(true);
      expect((await statusOf(jobId, creator).expect(200)).body).toEqual({
        data: {
          id: jobId,
          state: 'waiting',
          step: 'queued',
          progress: null,
          result: null,
          error: null,
          failedStep: null,
        },
      });
    });
    it('adds the requester to the given curators once', async () => {
      const jobId = jobIdOf(
        await upload(
          `code=cur1&curators=${importerId}&curators=${creatorId}`,
          creator,
        ).expect(202),
      );
      expect((await queue.getJob(jobId))?.data.curators).toEqual([
        importerId,
        creatorId,
      ]);
    });
    it("puts the requester's testcase limit in the job: 300, or 9999 with judge.create_mass_testcases", async () => {
      const massImporter = await loginAs(
        api,
        (
          await createUserWith(api, 'mass', {
            permissions: [
              'judge.import_polygon_package',
              'judge.add_problem',
              'judge.create_mass_testcases',
            ],
          })
        )._id,
      );
      const limitOf = async (code: string, session: TestSession) =>
        (
          await queue.getJob(
            jobIdOf(await upload(`code=${code}`, session).expect(202)),
          )
        )?.data.maxCases;
      expect(await limitOf('lim1', creator)).toBe(300);
      expect(await limitOf('lim2', massImporter)).toBe(9999);
    });
    it('shows a job only to its requester and a superuser', async () => {
      const jobId = jobIdOf(await upload('code=seen', creator).expect(202));
      await statusOf(jobId, plain).expect(403);
      await statusOf(jobId, otherImporter).expect(404);
      await statusOf(jobId, admin).expect(200);
      await statusOf(UNKNOWN_ID, creator).expect(404);
      await statusOf('not-a-uuid', creator).expect(400);
    });
    it('refuses the reserved problem codes in both modes and stores nothing', async () => {
      const before = storedPackages().length;
      for (const code of ['meta', 'deleted', 'imports'])
        for (const mode of ['create', 'update'])
          expect(
            fieldsOf(
              await upload(`code=${code}&mode=${mode}`, creator).expect(400),
            ),
          ).toHaveProperty('code');
      expect(storedPackages()).toHaveLength(before);
    });
    it('treats the code of a deleted or purged problem as taken before queueing anything', async () => {
      const before = storedPackages().length;
      const deleted = await createProblem(api, catalog, {
        code: 'imp_deleted',
      });
      await softDelete(api, deleted._id);
      const purged = await createProblem(api, catalog, { code: 'imp_purged' });
      await tombstone(api, purged._id);
      for (const code of ['imp_deleted', 'imp_purged'])
        expect(
          fieldsOf(await upload(`code=${code}`, creator).expect(400)),
        ).toHaveProperty('code');
      expect(storedPackages()).toHaveLength(before);
    });
    it('validates the query strictly before storing anything', async () => {
      const before = storedPackages().length;
      expect(
        fieldsOf(await upload('code=mine', creator).expect(400)),
      ).toHaveProperty('code');
      expect(
        fieldsOf(await upload('code=Bad', creator).expect(400)),
      ).toHaveProperty('code');
      expect(
        fieldsOf(await upload('code=x1&mode=delete', creator).expect(400)),
      ).toHaveProperty('mode');
      expect(
        fieldsOf(await upload('code=x1&points=abc', creator).expect(400)),
      ).toHaveProperty('points');
      expect(
        fieldsOf(await upload('code=x1&groupId=nope', creator).expect(400)),
      ).toHaveProperty('groupId');
      expect(
        fieldsOf(
          await upload('code=x1&appendMainSolution=maybe', creator).expect(400),
        ),
      ).toHaveProperty('appendMainSolution');
      expect(
        fieldsOf(
          await upload('code=x1&statementLanguages=english-en', creator).expect(
            400,
          ),
        ),
      ).toHaveProperty('statementLanguages');
      expect(
        fieldsOf(
          await upload(`code=x1&typeIds=${UNKNOWN_ID}`, creator).expect(400),
        ),
      ).toHaveProperty('typeIds');
      expect(
        fieldsOf(
          await upload(`code=x1&authors=${UNKNOWN_ID}`, creator).expect(400),
        ),
      ).toHaveProperty('authors');
      expect(storedPackages()).toHaveLength(before);
    });
    it('applies the create and update access rules', async () => {
      const before = storedPackages().length;
      await upload('code=x5', importer).expect(403);
      await upload('code=ghost&mode=update', importer).expect(404);
      await upload('code=theirs&mode=update', importer).expect(403);
      await upload('code=fancy&mode=update', importer)
        .expect(403)
        .expect(errorCode('forbidden'));
      await upload('code=managed&mode=update', importer).expect(404);
      expect(storedPackages()).toHaveLength(before);
    });
    it('keeps the catalog of an updated problem unless given and pins its data version', async () => {
      const jobId = jobIdOf(
        await upload('code=mine&mode=update&points=1500', importer).expect(202),
      );
      const data = (await queue.getJob(jobId))?.data;
      expect(data).toMatchObject({
        mode: 'update',
        points: 1500,
        isFullMarkup: false,
        expectedDataVersion: 3,
      });
      for (const key of ['authors', 'curators', 'groupId', 'typeIds'])
        expect(data).not.toHaveProperty(key);
    });
    it('refuses a package without problem.xml or a non-zip and removes the file', async () => {
      const before = storedPackages().length;
      const noXml = await upload(
        'code=x2',
        creator,
        buildZip([{ name: 'readme.txt', content: 'x' }]),
      ).expect(400);
      expect(fieldsOf(noXml)).toHaveProperty('file');
      expect(issuesOf(noXml)).toEqual([
        expect.objectContaining({ field: 'file', code: 'no_problem_xml' }),
      ]);
      const notZip = await upload(
        'code=x3',
        creator,
        Buffer.from('nope'),
      ).expect(400);
      expect(fieldsOf(notZip)).toHaveProperty('file');
      expect(issuesOf(notZip)).toEqual([
        expect.objectContaining({ field: 'file', code: 'zip_invalid' }),
      ]);
      expect(storedPackages()).toHaveLength(before);
    });
    it('needs judge.import_polygon_package', async () => {
      await upload('code=x4', plain).expect(403);
      await api.http().post(`${IMPORTS}?code=x4`).expect(401);
    });
    it('shows an import error as is and hides any other failure reason', async () => {
      const hidden = jobIdOf(await upload('code=leak1', creator).expect(202));
      const shown = jobIdOf(await upload('code=leak2', creator).expect(202));
      await failAllJobs((code) =>
        code === 'leak2'
          ? `${POLYGON_ERROR_PREFIX}not full package`
          : 'ENOSPC: no space left, write /data/problems/.imports/a.zip',
      );
      const hiddenBody: unknown = (await statusOf(hidden, creator).expect(200))
        .body;
      expect((hiddenBody as { data: Status }).data).toMatchObject({
        state: 'failed',
        step: 'failed',
        error: 'Import failed',
      });
      expect(JSON.stringify(hiddenBody)).not.toContain('/data/');
      const shownBody: unknown = (await statusOf(shown, creator).expect(200))
        .body;
      expect((shownBody as { data: Status }).data.error).toBe(
        'not full package',
      );
    });
    it('caps the import error it shows', async () => {
      const jobId = jobIdOf(await upload('code=longerr', creator).expect(202));
      await failAllJobs(() => `${POLYGON_ERROR_PREFIX}${'x'.repeat(5000)}`);
      const body = (await statusOf(jobId, creator).expect(200)).body as {
        data: Status;
      };
      expect(body.data.error).toBe('x'.repeat(1000));
    });
    it('rate-limits imports per user and sweeps stale packages', async () => {
      const stale = join(importsDirectory(), 'stale.zip');
      writeFileSync(stale, 'x');
      const longAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      utimesSync(stale, longAgo, longAgo);
      const statuses: number[] = [];
      for (let attempt = 0; attempt < IMPORT_LIMIT + 2; attempt += 1)
        statuses.push(
          (await upload('code=rl', admin, Buffer.from('nope'))).status,
        );
      expect(statuses).toEqual([
        ...Array<number>(IMPORT_LIMIT).fill(400),
        429,
        429,
      ]);
      expect(existsSync(stale)).toBe(false);
    });
  });
}

// from problems-uploads.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';
  const urlOf = ({ body }: { body: unknown }) =>
    (body as { data: { url: string } }).data.url;

  /** The stable issue code of a file refusal: `issues: [{ field: 'file', code, message }]`. */
  const fileIssueOf = ({ body }: { body: unknown }) =>
    (body as { error: { issues: { field: string; code: string }[] } }).error
      .issues[0];

  describe('problem uploads', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let staff: TestSession;
    let uploader: TestSession;
    let plain: TestSession;
    let editor: TestSession;

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      const staffUser = await createUserWith(api, 'staff', { isStaff: true });
      const uploaderUser = await createUserWith(api, 'uploader', {
        permissions: ['judge.can_upload_image'],
      });
      const plainUser = await createUserWith(api, 'plain');
      const editorUser = await createUserWith(api, 'editor', {
        permissions: [
          'judge.edit_own_problem',
          'judge.upload_file_statement',
          'judge.upload_problem_material',
        ],
      });
      staff = await loginAs(api, staffUser._id);
      uploader = await loginAs(api, uploaderUser._id);
      plain = await loginAs(api, plainUser._id);
      editor = await loginAs(api, editorUser._id);
      await createProblem(api, catalog, {
        code: 'sum',
        authors: [editorUser._id],
      });
      await createProblem(api, catalog, { code: 'other' });
    });

    const upload = (
      path: string,
      session: TestSession,
      {
        content,
        filename,
        contentType = 'application/octet-stream',
      }: { content: Buffer; filename: string; contentType?: string },
    ) =>
      authed(api.http().post(path), session).attach('file', content, {
        filename,
        contentType,
      });

    it('stores images for staff and judge.can_upload_image under images/<uuid>.<ext>', async () => {
      const url = urlOf(
        await upload(`${PROBLEMS}/uploads/image`, staff, {
          content: PNG,
          filename: 'photo.png',
          contentType: 'image/png',
        }).expect(201),
      );
      expect(url).toMatch(/^\/media\/images\/[0-9a-f-]{36}\.png$/);
      expect(
        readFileSync(join(api.mediaRoot, url.replace('/media/', ''))),
      ).toEqual(PNG);
      await upload(`${PROBLEMS}/uploads/image`, uploader, {
        content: PNG,
        filename: 'anything.jpg',
        contentType: 'image/jpeg',
      }).expect(201);
      await upload(`${PROBLEMS}/uploads/image`, plain, {
        content: PNG,
        filename: 'photo.png',
        contentType: 'image/png',
      })
        .expect(403)
        .expect(errorCode('forbidden'));
    });
    it('decides the type from the bytes, not the name', async () => {
      const response = await upload(`${PROBLEMS}/uploads/image`, staff, {
        content: Buffer.from('<html>not an image</html>'),
        filename: 'fake.png',
        contentType: 'image/png',
      }).expect(400);
      expect(
        (response.body as { error: { fields: Record<string, string[]> } }).error
          .fields,
      ).toHaveProperty('file');
      expect(fileIssueOf(response)).toMatchObject({
        field: 'file',
        code: 'image_type_not_allowed',
      });
      await upload(`${PROBLEMS}/uploads/image`, staff, {
        content: PDF,
        filename: 'doc.gif',
        contentType: 'image/gif',
      }).expect(400);
      await authed(api.http().post(`${PROBLEMS}/uploads/image`), staff)
        .expect(400)
        .expect(errorCode('validation_failed'));
    });
    it('sanitizes svg', async () => {
      const url = urlOf(
        await upload(`${PROBLEMS}/uploads/image`, staff, {
          content: SVG_WITH_SCRIPT,
          filename: 'figure.svg',
          contentType: 'image/svg+xml',
        }).expect(201),
      );
      const stored = readFileSync(
        join(api.mediaRoot, url.replace('/media/', '')),
        'utf8',
      );
      expect(url).toMatch(/\.svg$/);
      expect(stored).not.toMatch(/<script/i);
      expect(stored).not.toMatch(/\bon\w+\s*=/i);
      expect(stored).not.toMatch(/<foreignObject/i);
      expect(stored).toContain('<rect');
    });
    it.each([
      [
        'too large',
        `<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(600 * 1024)}</svg>`,
      ],
      ['too many tags', `<svg>${'<g/>'.repeat(20001)}</svg>`],
      ['too deep', `<svg>${'<g>'.repeat(1001)}`],
      ['full of NBSP-named elements', `<svg>${'<\u00A0>'.repeat(20001)}`],
      ['full of odd element names', `<svg>${'<_>'.repeat(20001)}`],
    ])('refuses an svg that is %s', async (_label, svg) => {
      const response = await upload(`${PROBLEMS}/uploads/image`, staff, {
        content: Buffer.from(svg),
        filename: 'bomb.svg',
        contentType: 'image/svg+xml',
      }).expect(400);
      expect(
        (response.body as { error: { fields: Record<string, string[]> } }).error
          .fields,
      ).toHaveProperty('file');
    });
    it('accepts an svg of exactly the byte cap and refuses one byte more', async () => {
      const svgOfSize = (bytes: number) => {
        const wrapper = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        return Buffer.from(
          wrapper.replace(
            '</svg>',
            ' '.repeat(bytes - wrapper.length) + '</svg>',
          ),
        );
      };
      await upload(`${PROBLEMS}/uploads/image`, staff, {
        content: svgOfSize(SVG_MAX_BYTES),
        filename: 'edge.svg',
        contentType: 'image/svg+xml',
      }).expect(201);
      const response = await upload(`${PROBLEMS}/uploads/image`, staff, {
        content: svgOfSize(SVG_MAX_BYTES + 1),
        filename: 'over.svg',
        contentType: 'image/svg+xml',
      }).expect(400);
      expect(
        (response.body as { error: { fields: Record<string, string[]> } }).error
          .fields,
      ).toHaveProperty('file');
    });
    it('refuses oversized images with 413', async () => {
      await upload(`${PROBLEMS}/uploads/image`, staff, {
        content: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]),
        filename: 'big.png',
        contentType: 'image/png',
      })
        .expect(413)
        .expect(errorCode('file_too_large'));
    });
    it('attaches a PDF statement to an editable problem', async () => {
      const url = urlOf(
        await upload(`${PROBLEMS}/sum/statement`, editor, {
          content: PDF,
          filename: 'statement.pdf',
          contentType: 'application/pdf',
        }).expect(201),
      );
      expect(url).toMatch(/^\/media\/pdf\/[0-9a-f-]{36}\.pdf$/);
      expect(
        (await api.problems.findOne({ code: 'sum' }))!.pdfStatementUrl,
      ).toBe(url);
      await upload(`${PROBLEMS}/sum/statement`, editor, {
        content: PNG,
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      }).expect(400);
      await upload(`${PROBLEMS}/other/statement`, editor, {
        content: PDF,
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      }).expect(403);
      await upload(`${PROBLEMS}/sum/statement`, staff, {
        content: PDF,
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      }).expect(403);
      await upload(`${PROBLEMS}/missing/statement`, editor, {
        content: PDF,
        filename: 'statement.pdf',
        contentType: 'application/pdf',
      }).expect(404);
      expect(await api.revisions.countDocuments({ action: 'upload' })).toBe(1);
    });
    it('stores materials under materials/<problem id>/<safe name>', async () => {
      const problemId = (await api.problems.findOne({ code: 'sum' }))!._id;
      const url = urlOf(
        await upload(`${PROBLEMS}/sum/material`, editor, {
          content: Buffer.from('zip'),
          filename: 'my file (final).zip',
        }).expect(201),
      );
      expect(url).toBe(`/media/materials/${problemId}/my_file_final.zip`);
      expect(url).toMatch(
        /^\/media\/materials\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/my_file_final\.zip$/,
      );
      expect(
        existsSync(
          join(
            api.mediaRoot,
            'materials',
            String(problemId),
            'my_file_final.zip',
          ),
        ),
      ).toBe(true);
      expect((await api.problems.findOne({ code: 'sum' }))!.materialUrl).toBe(
        url,
      );
      await upload(`${PROBLEMS}/sum/material`, editor, {
        content: Buffer.alloc(20 * 1024 * 1024 + 1),
        filename: 'big.zip',
      }).expect(413);
      await upload(`${PROBLEMS}/sum/material`, plain, {
        content: Buffer.from('zip'),
        filename: 'x.zip',
      }).expect(403);
    });
    it('removes the replaced PDF and material files', async () => {
      const mediaPath = (url: string) =>
        join(api.mediaRoot, url.replace('/media/', ''));
      const firstPdf = (await api.problems.findOne({ code: 'sum' }))!
        .pdfStatementUrl!;
      const secondPdf = urlOf(
        await upload(`${PROBLEMS}/sum/statement`, editor, {
          content: PDF,
          filename: 's.pdf',
          contentType: 'application/pdf',
        }).expect(201),
      );
      expect(existsSync(mediaPath(firstPdf))).toBe(false);
      expect(existsSync(mediaPath(secondPdf))).toBe(true);
      const firstMaterial = (await api.problems.findOne({ code: 'sum' }))!
        .materialUrl!;
      await upload(`${PROBLEMS}/sum/material`, editor, {
        content: Buffer.from('zip'),
        filename: 'second.zip',
      }).expect(201);
      expect(existsSync(mediaPath(firstMaterial))).toBe(false);
    });
    it('keeps a file that a clone still references', async () => {
      const cloner = await createUserWith(api, 'cloner', {
        permissions: [
          'judge.clone_problem',
          'judge.edit_own_problem',
          'judge.upload_file_statement',
        ],
      });
      const session = await loginAs(api, cloner._id);
      await createProblem(api, catalog, {
        code: 'src2',
        authors: [cloner._id],
      });
      const sharedUrl = urlOf(
        await upload(`${PROBLEMS}/src2/statement`, session, {
          content: PDF,
          filename: 's.pdf',
        }).expect(201),
      );
      await authed(api.http().post(`${PROBLEMS}/src2/clone`), session)
        .send({ code: 'copy2' })
        .expect(201);
      expect(
        (await api.problems.findOne({ code: 'copy2' }))!.pdfStatementUrl,
      ).toBe(sharedUrl);
      const ownUrl = urlOf(
        await upload(`${PROBLEMS}/copy2/statement`, session, {
          content: PDF,
          filename: 's.pdf',
        }).expect(201),
      );
      expect(ownUrl).not.toBe(sharedUrl);
      expect(
        existsSync(join(api.mediaRoot, sharedUrl.replace('/media/', ''))),
      ).toBe(true);
      expect(
        (await api.problems.findOne({ code: 'src2' }))!.pdfStatementUrl,
      ).toBe(sharedUrl);
    });
    it.each([
      ['../../../evil.zip', 'evil.zip'],
      ['..%2F..%2Fevil.zip', '2F.2Fevil.zip'],
      ['.hidden.txt', 'hidden.txt'],
      ['a/b\\..\\c.zip', 'c.zip'],
    ])(
      'never lets the material name %s leave its directory',
      async (name, safeName) => {
        const problemId = (await api.problems.findOne({ code: 'sum' }))!._id;
        expect(
          urlOf(
            await upload(`${PROBLEMS}/sum/material`, editor, {
              content: Buffer.from('zip'),
              filename: name,
            }).expect(201),
          ),
        ).toBe(`/media/materials/${problemId}/${safeName}`);
      },
    );
    it.each([
      '.htaccess',
      '..',
      'index.html',
      'a.htm',
      'a.xhtml',
      'a.svg',
      'a.xml',
      'a.js',
      'a.mjs',
      'a.shtml',
      'a.php',
      'a.HTML',
      'noext',
    ])('refuses the material name %s', async (name) => {
      const response = await upload(`${PROBLEMS}/sum/material`, editor, {
        content: Buffer.from('x'),
        filename: name,
      }).expect(400);
      expect(
        (response.body as { error: { fields: Record<string, string[]> } }).error
          .fields,
      ).toHaveProperty('file');
    });
    it('rejects empty files, extra fields, wrong field names and broken bodies', async () => {
      const path = `${PROBLEMS}/uploads/image`;
      await upload(path, staff, {
        content: Buffer.alloc(0),
        filename: 'e.png',
        contentType: 'image/png',
      }).expect(400);
      const unexpected = await authed(api.http().post(path), staff)
        .field('note', 'x')
        .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(400)
        .expect(errorCode('validation_failed'));
      expect(fileIssueOf(unexpected).code).toBe('upload_malformed');
      const misnamed = await authed(api.http().post(path), staff)
        .attach('picture', PNG, { filename: 'p.png', contentType: 'image/png' })
        .expect(400)
        .expect(errorCode('validation_failed'));
      expect(fileIssueOf(misnamed).code).toBe('exactly_one_file');
      const boundary = 'xBOUNDARYx';
      const raw = (body: Buffer) =>
        authed(api.http().post(path), staff)
          .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
          .send(body);
      const garbage = await raw(Buffer.from('garbage, not multipart'))
        .expect(400)
        .expect(errorCode('validation_failed'));
      expect(fileIssueOf(garbage).code).toBe('upload_malformed');
      const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`;
      await raw(Buffer.concat([Buffer.from(head), PNG]))
        .expect(400)
        .expect(errorCode('validation_failed'));
    });
    it('rate-limits uploads per user', async () => {
      for (let attempt = 0; attempt < 29; attempt++)
        await upload(`${PROBLEMS}/uploads/image`, uploader, {
          content: PNG,
          filename: 'p.png',
          contentType: 'image/png',
        }).expect(201);
      await upload(`${PROBLEMS}/uploads/image`, uploader, {
        content: PNG,
        filename: 'p.png',
        contentType: 'image/png',
      })
        .expect(429)
        .expect(errorCode('rate_limited'));
    });
  });
}

// from problems-pdf.e2e-spec.ts
{
  const PROBLEMS = '/api/internal/problems';

  const waitUntil = async (
    condition: () => Promise<boolean>,
  ): Promise<void> => {
    for (let attempt = 0; attempt < 100 && !(await condition()); attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 50));
  };

  describe('GET /api/internal/problems/:code/pdf', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let queue: Queue<PdfRenderJob>;
    let editor: TestSession;
    let redis: Redis;
    const resetBudget = async () => {
      const spent = await redis.keys('rate:*');
      if (spent.length) await redis.del(...spent);
    };
    const cachePdf = (name: string, content = '%PDF-1.4 cached') => {
      mkdirSync(api.pdfCacheRoot, { recursive: true });
      writeFileSync(join(api.pdfCacheRoot, name), content);
    };
    const failingWorker = async () => {
      const worker = new Worker(
        PDF_QUEUE,
        () => Promise.reject(new Error('render crashed')),
        { connection: { url: TEST_REDIS_URL } },
      );
      await worker.waitUntilReady();
      return worker;
    };

    beforeAll(async () => {
      catalog = await seedCatalog(api);
      queue = api.app.get(getQueueToken(PDF_QUEUE));
      redis = api.app.get<Redis>(REDIS);
      const editorUser = await createUserWith(api, 'editor', {
        permissions: ['judge.edit_own_problem'],
      });
      editor = await loginAs(api, editorUser._id);
      for (const code of [
        'sum',
        'again',
        'busy',
        'broken',
        'edited',
        'cycles',
        'burst',
        'peek',
        'raced',
        'warm',
        'rendered',
      ])
        await createProblem(api, catalog, { code, authors: [editorUser._id] });
      await createProblem(api, catalog, {
        code: 'duo',
        translations: [
          { language: 'vi', name: 'Duo', description: '', descriptionHtml: '' },
        ],
      });
      await createProblem(api, catalog, { code: 'hidden', isPublic: false });
    });

    it('answers 202 and enqueues one job per problem and language, deduplicated', async () => {
      const pending = await api.http().get(`${PROBLEMS}/sum/pdf`).expect(202);
      expect(pending.body).toEqual({ data: { status: 'rendering' } });
      expect(pending.headers['retry-after']).toBe('3');
      expect(pending.headers['cache-control']).toBe('no-store');
      await api.http().get(`${PROBLEMS}/sum/pdf`).expect(202);
      await api.http().get(`${PROBLEMS}/duo/pdf?lang=vi`).expect(202);
      await api.http().get(`${PROBLEMS}/sum/pdf?lang=en`).expect(202);
      expect((await queue.getJob(pdfJobId('sum', 'vi')))?.data).toEqual({
        code: 'sum',
        lang: 'vi',
      });
      expect((await queue.getJob(pdfJobId('duo', 'vi')))?.data).toEqual({
        code: 'duo',
        lang: 'vi',
      });
      expect(await queue.getJob(pdfJobId('sum', 'en'))).toBeUndefined();
      expect(await queue.getWaitingCount()).toBe(2);
    });
    it('serves the cached file inline', async () => {
      cachePdf('sum.vi.pdf');
      const response = await api
        .http()
        .get(`${PROBLEMS}/sum/pdf`)
        .buffer()
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-type']).toBe('application/pdf');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-disposition']).toBe(
        'inline; filename="sum.vi.pdf"',
      );
      expect(response.headers['content-length']).toBe('15');
      expect((response.body as Buffer).toString()).toBe('%PDF-1.4 cached');
    });
    it('serves the base statement file when the translation is missing (English asked, Vietnamese base)', async () => {
      const response = await api
        .http()
        .get(`${PROBLEMS}/sum/pdf?lang=en`)
        .expect(200);
      expect(response.headers['content-disposition']).toBe(
        'inline; filename="sum.vi.pdf"',
      );
    });
    it('enqueues again after the previous job completed', async () => {
      const worker = new Worker(PDF_QUEUE, () => Promise.resolve('rendered'), {
        connection: { url: TEST_REDIS_URL },
      });
      await worker.waitUntilReady();
      const completed = new Promise<void>((resolve) =>
        worker.on(
          'completed',
          (job) => job.id === pdfJobId('again', 'vi') && resolve(),
        ),
      );
      await api.http().get(`${PROBLEMS}/again/pdf`).expect(202);
      await completed;
      await worker.close();
      expect(await queue.getJob(pdfJobId('again', 'vi'))).toBeUndefined();
      await api.http().get(`${PROBLEMS}/again/pdf`).expect(202);
      expect(await queue.getJob(pdfJobId('again', 'vi'))).toBeDefined();
    }, 30000);
    it('hides invisible problems and validates the language', async () => {
      writeFileSync(join(api.pdfCacheRoot, 'hidden.vi.pdf'), '%PDF-1.4 secret');
      await api.http().get(`${PROBLEMS}/hidden/pdf`).expect(404);
      await api.http().get(`${PROBLEMS}/nope/pdf`).expect(404);
      await api
        .http()
        .get(`${PROBLEMS}/sum/pdf?lang=fr`)
        .expect(400)
        .expect(errorCode('validation_failed'));
    });
    it('rate limits new renders per ip, never polls of a pending one', async () => {
      await resetBudget();
      const spamCodes = Array.from(
        { length: 30 },
        (_unused, index) => `spam${index}`,
      );
      for (const code of spamCodes) await createProblem(api, catalog, { code });
      for (let poll = 0; poll < 40; poll += 1)
        await api.http().get(`${PROBLEMS}/busy/pdf`).expect(202);
      for (const code of ['busy', ...spamCodes.slice(0, 29)])
        await api.http().get(`${PROBLEMS}/${code}/pdf`).expect(202);
      await api
        .http()
        .get(`${PROBLEMS}/${spamCodes[29]}/pdf`)
        .expect(429)
        .expect(errorCode('rate_limited'));
      await queue.obliterate({ force: true });
    }, 60000);
    it('answers 503 with Retry-After after a failed render, until the statement changes', async () => {
      await resetBudget();
      const worker = await failingWorker();
      const failed = new Promise<void>((resolve) =>
        worker.once('failed', () => resolve()),
      );
      await api.http().get(`${PROBLEMS}/edited/pdf`).expect(202);
      await failed;
      await worker.close();
      const refused = await api
        .http()
        .get(`${PROBLEMS}/edited/pdf`)
        .expect(503)
        .expect(errorCode('pdf_unavailable'));
      const retryAfter = Number(refused.headers['retry-after']);
      expect(refused.headers['cache-control']).toBe('no-store');
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(600);
      await authed(api.http().patch(`${PROBLEMS}/edited`), editor)
        .send({ description: 'Fixed text' })
        .expect(200);
      await waitUntil(
        async () => !(await queue.getJob(pdfJobId('edited', 'vi'))),
      );
      await api.http().get(`${PROBLEMS}/edited/pdf`).expect(202);
      const job = await queue.getJob(pdfJobId('edited', 'vi'));
      expect(job).toBeDefined();
      expect(await job?.isFailed()).toBe(false);
    }, 30000);
    it('never answers 503 across successful renders', async () => {
      await resetBudget();
      const worker = new Worker(PDF_QUEUE, () => Promise.resolve('rendered'), {
        connection: { url: TEST_REDIS_URL },
      });
      await worker.waitUntilReady();
      for (let cycle = 0; cycle < 6; cycle += 1) {
        await api.http().get(`${PROBLEMS}/cycles/pdf`).expect(202);
        await waitUntil(
          async () => !(await queue.getJob(pdfJobId('cycles', 'vi'))),
        );
      }
      await worker.close();
    }, 30000);
    it('makes exactly one job out of a concurrent burst', async () => {
      await resetBudget();
      await Promise.all(
        Array.from({ length: 30 }, () =>
          api.http().get(`${PROBLEMS}/burst/pdf`).expect(202),
        ),
      );
      const waiting = await queue.getWaiting();
      expect(waiting.filter((job) => job.data.code === 'burst')).toHaveLength(
        1,
      );
    });
    it('does not spend the ip budget on cached hits', async () => {
      await resetBudget();
      cachePdf('warm.vi.pdf');
      for (let hit = 0; hit < 40; hit += 1)
        await api.http().get(`${PROBLEMS}/warm/pdf`).expect(200);
      expect(await redis.keys('rate:*pdf-render*')).toEqual([]);
    });
    it('answers HEAD from the cache only, never enqueueing or spending budget', async () => {
      await resetBudget();
      cachePdf('peek.vi.pdf');
      const cached = await api.http().head(`${PROBLEMS}/peek/pdf`).expect(200);
      expect(cached.headers['content-type']).toBe('application/pdf');
      await api.http().head(`${PROBLEMS}/again2/pdf`).expect(404);
      await api.http().head(`${PROBLEMS}/busy/pdf?lang=vi`).expect(202);
      expect(await queue.getJob(pdfJobId('busy', 'vi'))).toBeUndefined();
      expect(await redis.keys('rate:*pdf-render*')).toEqual([]);
    });
    it('answers 200 on the same URL once the render job has written the file', async () => {
      await resetBudget();
      const worker = new Worker<PdfRenderJob>(
        PDF_QUEUE,
        (job) => {
          cachePdf(
            `${job.data.code}.${job.data.lang}.pdf`,
            '%PDF-1.4 rendered',
          );
          return Promise.resolve('rendered');
        },
        { connection: { url: TEST_REDIS_URL } },
      );
      await worker.waitUntilReady();
      const completed = new Promise<void>((resolve) =>
        worker.on(
          'completed',
          (job) => job.id === pdfJobId('rendered', 'vi') && resolve(),
        ),
      );
      try {
        const pending = await api
          .http()
          .get(`${PROBLEMS}/rendered/pdf`)
          .expect(202);
        expect(pending.headers['retry-after']).toMatch(/^\d+$/);
        await completed;
      } finally {
        await worker.close();
      }
      const ready = await api
        .http()
        .get(`${PROBLEMS}/rendered/pdf`)
        .expect(200);
      expect(ready.headers['content-type']).toBe('application/pdf');
      expect(ready.headers['content-disposition']).toBe(
        'inline; filename="rendered.vi.pdf"',
      );
    }, 30000);
    it('falls back to rendering when the file vanishes before it is opened', async () => {
      await resetBudget();
      cachePdf('raced.vi.pdf');
      const cache = api.app.get(PdfCacheService);
      const open = cache.open.bind(cache);
      const spy = jest
        .spyOn(cache, 'open')
        .mockImplementationOnce((code, lang) => {
          rmSync(join(api.pdfCacheRoot, 'raced.vi.pdf'));
          return open(code, lang);
        });
      try {
        await api.http().get(`${PROBLEMS}/raced/pdf`).expect(202);
      } finally {
        spy.mockRestore();
      }
      expect(await queue.getJob(pdfJobId('raced', 'vi'))).toBeDefined();
    });
  });
}

// from problems-data-files.e2e-spec.ts
{
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

  const codeOf = ({ body }: { body: unknown }) =>
    (body as { error: { issues: { code: string }[] } }).error.issues[0]?.code;

  describe('problem data files', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let editor: TestSession;
    let plain: TestSession;
    let directory: string;

    beforeAll(async () => {
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
        '.data-version',
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
      expect(readdirSync(directory).sort()).toEqual([
        '.data-version',
        'init.yml',
        'tests.zip',
      ]);
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
      expect(
        codeOf(
          await upload(
            archive,
            editor,
            Buffer.from('not a zip'),
            'tests.zip',
          ).expect(400),
        ),
      ).toBe('zip_invalid');
      expect(
        codeOf(
          await upload(archive, editor, buildZip(tests(1)), 'tests.rar').expect(
            400,
          ),
        ),
      ).toBe('zip_required');
      await upload(archive, editor, Buffer.alloc(0), 'tests.zip').expect(400);
      await authed(api.http().post(archive), editor)
        .field('note', 'x')
        .attach('file', buildZip(tests(1)), 'tests.zip')
        .expect(400);
      await upload(archive, plain, buildZip(tests(1)), 'tests.zip').expect(403);
      expect(readdirSync(directory).sort()).toEqual([
        '.data-version',
        'init.yml',
        'tests.zip',
      ]);
      expect(readdirSync(api.problemDataRoot).sort()).toEqual(['sum']);
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
      // the worker compiles it on a judge; until then the editor shows it pending
      expect(data.sourceChecks.customChecker).toMatchObject({
        file: 'chk.cpp',
        status: 'pending',
      });
      const checks: Queue<SourceCheckJob> = api.app.get(
        getQueueToken(SOURCE_CHECK_QUEUE),
      );
      const queued = await checks.getJobs(['waiting', 'delayed']);
      expect(queued.map((job) => job.data)).toContainEqual(
        expect.objectContaining({ kind: 'customChecker', file: 'chk.cpp' }),
      );
      const files = `${PROBLEMS}/sum/data/files`;
      expect(
        codeOf(
          await upload(
            `${files}/customChecker`,
            editor,
            Buffer.from('print(1)'),
            'chk.py',
          ).expect(400),
        ),
      ).toBe('extension_not_allowed');
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
      await upload(
        `${files}/archive`,
        editor,
        Buffer.from('x'),
        'a.zip',
      ).expect(400);
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
    describe('lost races never leave disk and Mongo disagreeing', () => {
      const storedData = async () =>
        dataOf(
          await authed(api.http().get(`${PROBLEMS}/sum/data`), editor).expect(
            200,
          ),
        );
      const initArchive = () =>
        (
          parse(readFileSync(join(directory, 'init.yml'), 'utf8')) as {
            archive: string;
          }
        ).archive;
      const loseNextUpdate = () =>
        jest
          .spyOn(api.app.get(ProblemsRepository), 'updateData')
          .mockResolvedValueOnce(false);

      it('keeps the old archive when a same-name re-upload loses the CAS', async () => {
        await upload(
          `${PROBLEMS}/sum/data/archive`,
          editor,
          buildZip(tests(1)),
          'race.zip',
        ).expect(201);
        const before = await listZipEntries(join(directory, 'race.zip'));
        const spy = loseNextUpdate();
        await upload(
          `${PROBLEMS}/sum/data/archive`,
          editor,
          buildZip(tests(3)),
          'race.zip',
        ).expect(409);
        spy.mockRestore();
        expect(await listZipEntries(join(directory, 'race.zip'))).toEqual(
          before,
        );
        expect((await storedData()).archiveFiles).toEqual(before);
        expect(initArchive()).toBe('race.zip');
        expect(
          readdirSync(directory).filter(
            (name) => name.startsWith('.') && name !== '.data-version',
          ),
        ).toEqual([]);
      });
      it('lets exactly one of two concurrent same-name archive uploads win, intact on disk', async () => {
        await upload(
          `${PROBLEMS}/sum/data/archive`,
          editor,
          buildZip(tests(1)),
          'first.zip',
        ).expect(201);
        const repository = api.app.get(ProblemsRepository);
        const original = repository.findByCodeWithData.bind(repository);
        let arrived = 0;
        let release!: () => void;
        const bothRead = new Promise<void>((resolve) => (release = resolve));
        const spy = jest
          .spyOn(repository, 'findByCodeWithData')
          .mockImplementation(async (code) => {
            const problem = await original(code);
            if (++arrived === 2) release();
            await bothRead;
            return problem;
          });
        const [small, large] = await Promise.all([
          upload(
            `${PROBLEMS}/sum/data/archive`,
            editor,
            buildZip(tests(2)),
            'tests.zip',
          ),
          upload(
            `${PROBLEMS}/sum/data/archive`,
            editor,
            buildZip(tests(4)),
            'tests.zip',
          ),
        ]);
        spy.mockRestore();
        expect([small.status, large.status].sort()).toEqual([201, 409]);
        const stored = await storedData();
        expect(stored.archive).toBe('tests.zip');
        expect(stored.archiveFiles).toHaveLength(small.status === 201 ? 4 : 8);
        expect(await listZipEntries(join(directory, 'tests.zip'))).toEqual(
          stored.archiveFiles,
        );
        expect(initArchive()).toBe('tests.zip');
        expect(
          readdirSync(directory).filter((name) => name.endsWith('.zip')),
        ).toEqual(['tests.zip']);
        expect(
          readdirSync(directory).filter(
            (name) => name.startsWith('.') && name !== '.data-version',
          ),
        ).toEqual([]);
      });
      it('keeps the old source when a same-name re-upload loses the CAS', async () => {
        const url = `${PROBLEMS}/sum/data/files/generator`;
        await upload(url, editor, Buffer.from('v1'), 'gen.cpp').expect(201);
        const spy = loseNextUpdate();
        await upload(url, editor, Buffer.from('v2'), 'gen.cpp').expect(409);
        spy.mockRestore();
        expect(readFileSync(join(directory, 'gen.cpp'), 'utf8')).toBe('v1');
      });
      it('lets exactly one of two concurrent same-name source uploads win with its own content', async () => {
        const url = `${PROBLEMS}/sum/data/files/generator`;
        await upload(url, editor, Buffer.from('old'), 'first.cpp').expect(201);
        const repository = api.app.get(ProblemsRepository);
        const original = repository.findByCodeWithData.bind(repository);
        let arrived = 0;
        let release!: () => void;
        const bothRead = new Promise<void>((resolve) => (release = resolve));
        const spy = jest
          .spyOn(repository, 'findByCodeWithData')
          .mockImplementation(async (code) => {
            const problem = await original(code);
            if (++arrived === 2) release();
            await bothRead;
            return problem;
          });
        const [first, second] = await Promise.all([
          upload(url, editor, Buffer.from('first'), 'gen2.cpp'),
          upload(url, editor, Buffer.from('second'), 'gen2.cpp'),
        ]);
        spy.mockRestore();
        expect([first.status, second.status].sort()).toEqual([201, 409]);
        expect((await storedData()).generator).toBe('gen2.cpp');
        expect(readFileSync(join(directory, 'gen2.cpp'), 'utf8')).toBe(
          first.status === 201 ? 'first' : 'second',
        );
        expect(existsSync(join(directory, 'first.cpp'))).toBe(false);
        expect(
          readdirSync(directory).filter(
            (name) => name.startsWith('.') && name !== '.data-version',
          ),
        ).toEqual([]);
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
      expect(data.sourceChecks.customChecker).toBeNull();
      expect(data.feedback).toBe(
        'A custom checker file is required for the custom checker.',
      );
      expect(existsSync(join(directory, 'chk.cpp'))).toBe(false);
      expect(existsSync(join(directory, 'init.yml'))).toBe(false);
      const { dataVersion } = (await api.problems
        .findOne({ code: 'sum' })
        .lean())!;
      expect(readFileSync(join(directory, '.data-version'), 'utf8')).toBe(
        `${dataVersion}\n`,
      );
      await authed(
        api.http().delete(`${PROBLEMS}/sum/data/files/customChecker`),
        editor,
      ).expect(200);
    });
    it('downloads data files for editors only, with path containment', async () => {
      const url = `${PROBLEMS}/sum/data/files`;
      const archive = dataOf(
        await authed(api.http().get(`${PROBLEMS}/sum/data`), editor).expect(
          200,
        ),
      ).archive as string;
      const response = await authed(api.http().get(`${url}/${archive}`), editor)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${archive}"`,
      );
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      // Buffer.equals: toEqual walks a 21 MiB buffer element by element.
      expect(
        (response.body as Buffer).equals(
          readFileSync(join(directory, archive)),
        ),
      ).toBe(true);
      await authed(api.http().get(`${url}/${archive}`), plain).expect(403);
      await api.http().get(`${url}/${archive}`).expect(401);
      await authed(api.http().get(`${url}/nope.zip`), editor).expect(404);
      await authed(
        api.http().get(`${url}/..%2F..%2Fetc%2Fpasswd`),
        editor,
      ).expect(404);
      await authed(api.http().get(`${url}/%2e%2e`), editor).expect(404);
      await authed(api.http().get(`${url}/.upload-x`), editor).expect(404);
    });
    describe('a rename between load and compare-and-set', () => {
      const racerDirectory = () => join(api.problemDataRoot, 'racer');
      const racerArchive = async () =>
        dataOf(
          await authed(api.http().get(`${PROBLEMS}/racer/data`), editor).expect(
            200,
          ),
        ).archive;
      const renameDuringNextUpdate = () => {
        const repository = api.app.get(ProblemsRepository);
        const original = repository.updateData.bind(repository);
        return jest
          .spyOn(repository, 'updateData')
          .mockImplementationOnce(async (...args) => {
            await api.problems.updateOne(
              { code: 'racer' },
              { code: 'renamed' },
            );
            return original(...args);
          });
      };

      beforeAll(async () => {
        await createProblem(api, catalog, {
          code: 'racer',
          authors: [(await api.users.findOne({ username: 'editor' }))!._id],
        });
        await upload(
          `${PROBLEMS}/racer/data/archive`,
          editor,
          buildZip(tests(1)),
          'first.zip',
        ).expect(201);
        await authed(api.http().put(`${PROBLEMS}/racer/data`), editor)
          .send({
            checker: 'standard',
            grader: 'standard',
            cases: [{ type: 'C', input: '1.in', output: '1.out', points: 1 }],
          })
          .expect(200);
      });
      afterEach(async () => {
        jest.restoreAllMocks();
        await api.problems.updateOne({ code: 'renamed' }, { code: 'racer' });
      });

      it('answers 409 and writes nothing when it lands inside a PUT', async () => {
        const initBefore = readFileSync(
          join(racerDirectory(), 'init.yml'),
          'utf8',
        );
        const before = await api.problems.findOne({ code: 'racer' }).lean();
        renameDuringNextUpdate();
        await authed(api.http().put(`${PROBLEMS}/racer/data`), editor)
          .send({
            checker: 'standard',
            grader: 'standard',
            cases: [{ type: 'C', input: '1.in', output: '1.out', points: 7 }],
          })
          .expect(409);
        expect(readFileSync(join(racerDirectory(), 'init.yml'), 'utf8')).toBe(
          initBefore,
        );
        await api.problems.updateOne({ code: 'renamed' }, { code: 'racer' });
        expect(
          (await api.problems.findOne({ code: 'racer' }).lean())!.data,
        ).toEqual(before!.data);
      });
      it('answers 409, not 500, when it lands inside an archive upload', async () => {
        renameDuringNextUpdate();
        await upload(
          `${PROBLEMS}/racer/data/archive`,
          editor,
          buildZip(tests(2)),
          'raced.zip',
        ).expect(409);
        await api.problems.updateOne({ code: 'renamed' }, { code: 'racer' });
        expect(existsSync(join(racerDirectory(), 'raced.zip'))).toBe(false);
        expect(await racerArchive()).toBe('first.zip');
        expect(existsSync(join(racerDirectory(), 'first.zip'))).toBe(true);
      });
    });
  });
}
