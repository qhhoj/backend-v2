import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { uuidStr } from '@libs/database';
import { buildZip } from '@libs/problems/testing';
import {
  authed,
  createProblem,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { Catalog, TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const MIB = 1024 * 1024;
const UUID =
  '[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const PROJECT = Buffer.from('{"targets":[],"meta":{"semver":"3.0.0"}}');

const issueCodes = (response: { body: unknown }) =>
  (
    response.body as { error: { issues: Array<{ code: string }> } }
  ).error.issues.map((issue) => issue.code);

describe('POST /api/internal/problems/:code/submit/file', () => {
  let api: ApiTest;
  let catalog: Catalog;
  let uploader: { _id: string };
  let session: TestSession;
  let banned: TestSession;
  let bannedId: string;
  const languages: Record<'zip' | 'scratch' | 'off', string> = {
    zip: '',
    scratch: '',
    off: '',
  };
  const submitFile = (
    language: string,
    content: Buffer,
    filename: string,
    who: TestSession = session,
  ) =>
    authed(api.http().post('/api/internal/problems/files/submit/file'), who)
      .field('language', language)
      .attach('file', content, filename);
  const uploadDirectory = () =>
    join(api.mediaRoot, 'submission_file', 'files', uploader._id);
  const storedFiles = () =>
    existsSync(uploadDirectory()) ? readdirSync(uploadDirectory()) : [];
  const storedSource = async (id: string) =>
    (await api.submissionSources.findById(id).lean())!.source;

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const fileLanguage = (key: string, extension: string, limit: number) => ({
      key,
      name: key,
      commonName: key,
      ace: 'text',
      pygments: 'text',
      extension,
      fileOnly: true,
      fileSizeLimit: limit,
    });
    [languages.zip, languages.scratch, languages.off] = (
      await api.languages.create([
        fileLanguage('ZIPPED', 'zip', 1),
        fileLanguage('SCRATCH', 'sb3', 1),
        fileLanguage('ZIP0', 'zip', 0),
      ])
    ).map((language) => language._id);
    await api.resyncCatalog();
    uploader = await createUserWith(api, 'uploader', {
      permissions: ['judge.spam_submission'],
    });
    const bannedUser = await createUserWith(api, 'banned');
    await createProblem(api, catalog, {
      code: 'files',
      allowedLanguages: [catalog.languages.cpp, ...Object.values(languages)],
      bannedUsers: [bannedUser._id],
    });
    session = await loginAs(api, uploader._id);
    bannedId = bannedUser._id;
    banned = await loginAs(api, bannedId);
  });
  afterAll(() => api.teardown());

  it('stores the upload under submission_file and keeps its media URL as the source', async () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 10, 13]);
    const { id } = dataOf<{ id: string }>(
      await submitFile(languages.zip, bytes, 'answer.ZIP').expect(201),
    );
    const source = await storedSource(id);
    expect(source).toMatch(
      new RegExp(
        `^/media/submission_file/files/${uploader._id}/${UUID}\\.zip$`,
      ),
    );
    const name = source.split('/').pop()!;
    expect(readFileSync(join(uploadDirectory(), name))).toEqual(bytes);
    expect(
      dataOf<{ source: string }>(
        await authed(
          api.http().get(`/api/internal/submissions/${id}/source`),
          session,
        ).expect(200),
      ).source,
    ).toBe(source);
    const row = (await api.submissions.findById(id).lean())!;
    expect([row.status, uuidStr(row.language)]).toEqual(['QU', languages.zip]);
  });

  it('caps the file at fileSizeLimit MB and keeps nothing above it', async () => {
    const before = await api.submissions.countDocuments();
    const files = storedFiles().length;
    await submitFile(languages.zip, Buffer.alloc(MIB + 1, 7), 'big.zip')
      .expect(413)
      .expect(errorCode('file_too_large'));
    expect(await api.submissions.countDocuments()).toBe(before);
    expect(storedFiles()).toHaveLength(files);
    await submitFile(languages.zip, Buffer.alloc(MIB, 7), 'edge.zip').expect(
      201,
    );
  });

  it('wants the language extension', async () => {
    const files = storedFiles().length;
    const response = await submitFile(
      languages.zip,
      Buffer.from('x'),
      'answer.tar',
    ).expect(400);
    expect(issueCodes(response)).toEqual(['file_wrong_extension']);
    expect(storedFiles()).toHaveLength(files);
  });

  it('keeps the text and file paths apart', async () => {
    expect(
      issueCodes(
        await submitFile(
          catalog.languages.cpp,
          Buffer.from('int main(){}'),
          'a.cpp',
        ).expect(400),
      ),
    ).toEqual(['language_takes_text']);
    expect(
      issueCodes(
        await submitFile(languages.off, Buffer.from('x'), 'a.zip').expect(400),
      ),
    ).toEqual(['file_upload_disabled']);
    expect(
      issueCodes(
        await authed(
          api.http().post('/api/internal/problems/files/submit'),
          session,
        )
          .send({ language: languages.zip, source: 'x' })
          .expect(400),
      ),
    ).toEqual(['language_takes_file']);
  });

  it('runs the submit checks before anything is stored', async () => {
    const before = await api.submissions.countDocuments();
    await submitFile(languages.zip, Buffer.from('x'), 'a.zip', banned)
      .expect(403)
      .expect(errorCode('banned_from_problem'));
    expect(await api.submissions.countDocuments()).toBe(before);
    expect(
      existsSync(join(api.mediaRoot, 'submission_file', 'files', bannedId)),
    ).toBe(false);
  });

  it('wants the language field and exactly one part named file', async () => {
    const post = () =>
      authed(
        api.http().post('/api/internal/problems/files/submit/file'),
        session,
      );
    await post().attach('file', Buffer.from('x'), 'a.zip').expect(400);
    await post().field('language', languages.zip).expect(400);
    await post()
      .field('language', languages.zip)
      .attach('other', Buffer.from('x'), 'a.zip')
      .expect(400);
    await post()
      .field('language', languages.zip)
      .field('source', 'x')
      .attach('file', Buffer.from('x'), 'a.zip')
      .expect(400);
  });

  it('stores the project.json of a Scratch .sb3', async () => {
    const sb3 = buildZip([
      { name: 'project.json', content: PROJECT, method: 'deflate' },
      { name: 'costume.svg', content: '<svg/>' },
    ]);
    const { id } = dataOf<{ id: string }>(
      await submitFile(languages.scratch, sb3, 'game.sb3').expect(201),
    );
    const source = await storedSource(id);
    expect(source).toMatch(new RegExp(`/${UUID}\\.sb3$`));
    expect(
      readFileSync(join(uploadDirectory(), source.split('/').pop()!)),
    ).toEqual(PROJECT);
  });

  it.each([
    ['without project.json', buildZip([{ name: 'costume.svg', content: 'x' }])],
    [
      'with a path escaping the archive',
      buildZip([
        { name: '../project.json', content: PROJECT },
        { name: 'project.json', content: PROJECT },
      ]),
    ],
    [
      'whose project.json inflates past its declared size',
      buildZip([
        {
          name: 'project.json',
          content: Buffer.alloc(64 * 1024),
          method: 'deflate',
          declaredSize: 1024,
        },
      ]),
    ],
    ['that is not a zip', Buffer.from('not a zip at all')],
  ])('refuses a Scratch upload %s', async (_label, sb3) => {
    const before = await api.submissions.countDocuments();
    const files = storedFiles().length;
    const response = await submitFile(
      languages.scratch,
      sb3,
      'game.sb3',
    ).expect(400);
    expect(issueCodes(response)).toEqual(['scratch_project_invalid']);
    expect(await api.submissions.countDocuments()).toBe(before);
    expect(storedFiles()).toHaveLength(files);
  });

  it('caps the extracted project.json at fileSizeLimit MB', async () => {
    const bomb = buildZip([
      {
        name: 'project.json',
        content: Buffer.alloc(MIB + 1),
        method: 'deflate',
      },
    ]);
    expect(bomb.length).toBeLessThan(MIB);
    await submitFile(languages.scratch, bomb, 'bomb.sb3')
      .expect(413)
      .expect(errorCode('file_too_large'));
  });
});
