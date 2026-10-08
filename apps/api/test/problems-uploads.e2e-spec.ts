import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authed,
  Catalog,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
  TestSession,
} from './problem-fixtures';
import { SVG_MAX_BYTES } from '@libs/problems';
import { PDF, PNG, SVG_WITH_SCRIPT } from '@libs/problems/testing';
import { ApiTest, errorCode, setupApiTest } from './setup';

const PROBLEMS = '/api/internal/problems';
const urlOf = ({ body }: { body: unknown }) =>
  (body as { data: { url: string } }).data.url;

describe('problem uploads', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let staff: TestSession;
  let uploader: TestSession;
  let plain: TestSession;
  let editor: TestSession;

  beforeAll(async () => {
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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
    expect((await api.problems.findOne({ code: 'sum' }))!.pdfStatementUrl).toBe(
      url,
    );
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
    await createProblem(api, catalog, { code: 'src2', authors: [cloner._id] });
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
    await authed(api.http().post(path), staff)
      .field('note', 'x')
      .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    await authed(api.http().post(path), staff)
      .attach('picture', PNG, { filename: 'p.png', contentType: 'image/png' })
      .expect(400)
      .expect(errorCode('validation_failed'));
    const boundary = 'xBOUNDARYx';
    const raw = (body: Buffer) =>
      authed(api.http().post(path), staff)
        .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
        .send(body);
    await raw(Buffer.from('garbage, not multipart'))
      .expect(400)
      .expect(errorCode('validation_failed'));
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
