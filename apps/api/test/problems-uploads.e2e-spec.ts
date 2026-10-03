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
import { PDF, PNG, SVG_WITH_SCRIPT } from './sample-files';
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
    content: Buffer,
    filename: string,
    contentType = 'application/octet-stream',
  ) =>
    authed(api.http().post(path), session).attach('file', content, {
      filename,
      contentType,
    });

  it('stores images for staff and judge.can_upload_image under images/<uuid>.<ext>', async () => {
    const url = urlOf(
      await upload(
        `${PROBLEMS}/uploads/image`,
        staff,
        PNG,
        'photo.png',
        'image/png',
      ).expect(201),
    );
    expect(url).toMatch(/^\/media\/images\/[0-9a-f-]{36}\.png$/);
    expect(
      readFileSync(join(api.mediaRoot, url.replace('/media/', ''))),
    ).toEqual(PNG);
    await upload(
      `${PROBLEMS}/uploads/image`,
      uploader,
      PNG,
      'anything.jpg',
      'image/jpeg',
    ).expect(201);
    await upload(
      `${PROBLEMS}/uploads/image`,
      plain,
      PNG,
      'photo.png',
      'image/png',
    )
      .expect(403)
      .expect(errorCode('forbidden'));
  });
  it('decides the type from the bytes, not the name', async () => {
    const response = await upload(
      `${PROBLEMS}/uploads/image`,
      staff,
      Buffer.from('<html>not an image</html>'),
      'fake.png',
      'image/png',
    ).expect(400);
    expect(
      (response.body as { error: { fields: Record<string, string[]> } }).error
        .fields,
    ).toHaveProperty('file');
    await upload(
      `${PROBLEMS}/uploads/image`,
      staff,
      PDF,
      'doc.gif',
      'image/gif',
    ).expect(400);
    await authed(api.http().post(`${PROBLEMS}/uploads/image`), staff)
      .expect(400)
      .expect(errorCode('validation_failed'));
  });
  it('sanitizes svg', async () => {
    const url = urlOf(
      await upload(
        `${PROBLEMS}/uploads/image`,
        staff,
        SVG_WITH_SCRIPT,
        'figure.svg',
        'image/svg+xml',
      ).expect(201),
    );
    const stored = readFileSync(
      join(api.mediaRoot, url.replace('/media/', '')),
      'utf8',
    );
    expect(url).toMatch(/\.svg$/);
    expect(stored).not.toContain('script');
    expect(stored).not.toContain('onload');
    expect(stored).toContain('<rect');
  });
  it('refuses oversized images with 413', async () => {
    await upload(
      `${PROBLEMS}/uploads/image`,
      staff,
      Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]),
      'big.png',
      'image/png',
    )
      .expect(413)
      .expect(errorCode('file_too_large'));
  });
  it('attaches a PDF statement to an editable problem', async () => {
    const url = urlOf(
      await upload(
        `${PROBLEMS}/sum/statement`,
        editor,
        PDF,
        'statement.pdf',
        'application/pdf',
      ).expect(201),
    );
    expect(url).toMatch(/^\/media\/pdf\/[0-9a-f-]{36}\.pdf$/);
    expect((await api.problems.findOne({ code: 'sum' }))!.pdfStatementUrl).toBe(
      url,
    );
    await upload(
      `${PROBLEMS}/sum/statement`,
      editor,
      PNG,
      'statement.pdf',
      'application/pdf',
    ).expect(400);
    await upload(
      `${PROBLEMS}/other/statement`,
      editor,
      PDF,
      'statement.pdf',
      'application/pdf',
    ).expect(403);
    await upload(
      `${PROBLEMS}/sum/statement`,
      staff,
      PDF,
      'statement.pdf',
      'application/pdf',
    ).expect(403);
    await upload(
      `${PROBLEMS}/missing/statement`,
      editor,
      PDF,
      'statement.pdf',
      'application/pdf',
    ).expect(404);
    expect(await api.revisions.countDocuments({ action: 'upload' })).toBe(1);
  });
  it('stores materials under materials/<code>/<safe name>', async () => {
    const url = urlOf(
      await upload(
        `${PROBLEMS}/sum/material`,
        editor,
        Buffer.from('zip'),
        'my file (final).zip',
      ).expect(201),
    );
    expect(url).toBe('/media/materials/sum/my_file_final.zip');
    expect(
      existsSync(join(api.mediaRoot, 'materials', 'sum', 'my_file_final.zip')),
    ).toBe(true);
    expect((await api.problems.findOne({ code: 'sum' }))!.materialUrl).toBe(
      url,
    );
    await upload(
      `${PROBLEMS}/sum/material`,
      editor,
      Buffer.alloc(20 * 1024 * 1024 + 1),
      'big.zip',
    ).expect(413);
    await upload(
      `${PROBLEMS}/sum/material`,
      plain,
      Buffer.from('zip'),
      'x.zip',
    ).expect(403);
  });
  it.each([
    ['../../../evil.zip', '/media/materials/sum/evil.zip'],
    ['..%2F..%2Fevil.zip', '/media/materials/sum/2F.2Fevil.zip'],
    ['.htaccess', '/media/materials/sum/htaccess'],
    ['..', '/media/materials/sum/material'],
    ['a/b\\..\\c.zip', '/media/materials/sum/c.zip'],
  ])(
    'never lets the material name %s leave its directory',
    async (name, expected) => {
      expect(
        urlOf(
          await upload(
            `${PROBLEMS}/sum/material`,
            editor,
            Buffer.from('zip'),
            name,
          ).expect(201),
        ),
      ).toBe(expected);
    },
  );
  it('rate-limits uploads per user', async () => {
    for (let attempt = 0; attempt < 29; attempt++)
      await upload(
        `${PROBLEMS}/uploads/image`,
        uploader,
        PNG,
        'p.png',
        'image/png',
      ).expect(201);
    await upload(
      `${PROBLEMS}/uploads/image`,
      uploader,
      PNG,
      'p.png',
      'image/png',
    )
      .expect(429)
      .expect(errorCode('rate_limited'));
  });
});
