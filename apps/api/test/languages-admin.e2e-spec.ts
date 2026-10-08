import type { Test } from 'supertest';
import type { Permission } from '@libs/auth';
import type { LanguageAdminResponse } from '../src/modules/problems/catalog/dto/language-admin.response';
import type { ProblemMetaResponse } from '../src/modules/problems/core/dto/problem-meta.response';
import { authed } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { signedIn } from './ticket-fixtures';

const ADMIN = '/api/internal/admin/languages';
const META = '/api/internal/problems/meta';
type Session = Awaited<ReturnType<typeof signedIn>>['session'];

describe('languages administration', () => {
  let api: ApiTest;
  let counter = 0;
  const unique = (prefix: string) => `${prefix}${(counter += 1)}`;

  const staff = async (...permissions: Permission[]): Promise<Session> =>
    (await signedIn(api, unique('staff'), { permissions })).session;
  const send = (
    method: 'get' | 'post' | 'patch',
    path: string,
    session: Session,
    body?: object,
  ): Test => authed(api.http()[method](`${ADMIN}${path}`), session).send(body);
  const issueFields = (response: { body: unknown }) =>
    (
      response.body as { error: { issues: Array<{ field: string }> } }
    ).error.issues.map(({ field }) => field);
  const listed = async (session: Session) =>
    dataOf<LanguageAdminResponse[]>(await send('get', '', session).expect(200));
  const metaLanguageIds = async () =>
    dataOf<ProblemMetaResponse>(
      await api.http().get(META).expect(200),
    ).languages.map((language) => language.id);
  const newLanguage = (overrides: object = {}) => ({
    key: unique('L'),
    name: 'Scheme',
    commonName: 'Scheme',
    ace: 'scheme',
    pygments: 'scheme',
    extension: 'scm',
    ...overrides,
  });

  let editor: Session;
  let creator: Session;

  beforeAll(async () => {
    api = await setupApiTest();
    editor = await staff('judge.change_language');
    creator = await staff('judge.add_language');
  });
  afterAll(() => api.teardown());

  describe('create', () => {
    it('returns the stored language with defaults and lists it', async () => {
      const body = newLanguage({ key: 'Scm', shortName: 'SC' });
      const created = dataOf<LanguageAdminResponse>(
        await send('post', '', creator, body).expect(201),
      );
      expect(created).toMatchObject({
        key: 'Scm',
        name: 'Scheme',
        shortName: 'SC',
        commonName: 'Scheme',
        ace: 'scheme',
        pygments: 'scheme',
        template: '',
        info: '',
        description: '',
        extension: 'scm',
        fileOnly: false,
        fileSizeLimit: 0,
        includeInProblem: false,
      });
      expect(created.id).toEqual(expect.any(String));
      const found = (await listed(editor)).find(
        (language) => language.id === created.id,
      );
      expect(found).toEqual(created);
    });

    it('defaults shortName to null', async () => {
      const created = dataOf<LanguageAdminResponse>(
        await send('post', '', creator, newLanguage()).expect(201),
      );
      expect(created.shortName).toBeNull();
    });

    it('makes the language visible to the public problem meta at once', async () => {
      const created = dataOf<LanguageAdminResponse>(
        await send(
          'post',
          '',
          creator,
          newLanguage({ includeInProblem: true }),
        ).expect(201),
      );
      expect(await metaLanguageIds()).toContain(created.id);
    });

    it('rejects a key that differs only by case from an existing one with 409', async () => {
      await send('post', '', creator, newLanguage({ key: 'Dup' })).expect(201);
      await send('post', '', creator, newLanguage({ key: 'DUP' }))
        .expect(409)
        .expect(errorCode('conflict'));
    });

    it.each([
      ['extension with a path', { extension: '../x' }],
      ['extension with a dot', { extension: '.py' }],
      ['key with a space', { key: 'a b' }],
      ['key longer than 10 characters', { key: 'ABCDEFGHIJK' }],
      ['empty name', { name: '' }],
      ['name longer than 20 characters', { name: 'x'.repeat(21) }],
      ['ace longer than 50 characters', { ace: 'x'.repeat(51) }],
      ['negative fileSizeLimit', { fileSizeLimit: -1 }],
      ['fileSizeLimit above 1 GiB', { fileSizeLimit: 1_073_741_825 }],
      ['template above 64 KiB', { template: 'x'.repeat(65_537) }],
      ['unknown field', { color: 'red' }],
    ])('rejects %s with 400', async (_label, overrides) => {
      await send('post', '', creator, newLanguage(overrides)).expect(400);
    });
  });

  describe('update', () => {
    it('changes name and includeInProblem and leaves the key', async () => {
      const key = unique('U');
      const created = dataOf<LanguageAdminResponse>(
        await send('post', '', creator, newLanguage({ key })).expect(201),
      );
      const updated = dataOf<LanguageAdminResponse>(
        await send('patch', `/${created.id}`, editor, {
          name: 'Renamed',
          includeInProblem: true,
        }).expect(200),
      );
      expect(updated).toMatchObject({
        id: created.id,
        key,
        name: 'Renamed',
        includeInProblem: true,
      });
      expect(await metaLanguageIds()).toContain(created.id);
    });

    it('clears shortName with null but refuses null on other fields', async () => {
      const created = dataOf<LanguageAdminResponse>(
        await send(
          'post',
          '',
          creator,
          newLanguage({ shortName: 'SC' }),
        ).expect(201),
      );
      const cleared = dataOf<LanguageAdminResponse>(
        await send('patch', `/${created.id}`, editor, {
          shortName: null,
        }).expect(200),
      );
      expect(cleared.shortName).toBeNull();
      await send('patch', `/${created.id}`, editor, { name: null }).expect(400);
    });

    it('refuses a key in the body with 400 (keys are not renameable)', async () => {
      const created = dataOf<LanguageAdminResponse>(
        await send('post', '', creator, newLanguage()).expect(201),
      );
      const response = await send('patch', `/${created.id}`, editor, {
        key: 'Other',
      }).expect(400);
      expect(issueFields(response)).toContain('key');
      const [stored] = (await listed(editor)).filter(
        (language) => language.id === created.id,
      );
      expect(stored.key).not.toBe('Other');
    });

    it('answers 404 for an unknown id and 400 for a malformed one', async () => {
      await send('patch', '/00000000-0000-7000-8000-000000000000', editor, {
        name: 'Nope',
      }).expect(404);
      await send('patch', '/not-a-uuid', editor, { name: 'Nope' }).expect(400);
    });
  });

  describe('list', () => {
    it('sorts by name', async () => {
      await send('post', '', creator, newLanguage({ name: 'Zeta' })).expect(
        201,
      );
      await send('post', '', creator, newLanguage({ name: 'alpha' })).expect(
        201,
      );
      const names = (await listed(editor)).map((language) => language.name);
      expect(names.indexOf('alpha')).toBeLessThan(names.indexOf('Zeta'));
    });
  });

  describe('permissions', () => {
    it('answers 401 to anonymous callers on every route', async () => {
      await api.http().get(ADMIN).expect(401);
      await api.http().post(ADMIN).send(newLanguage()).expect(401);
      await api
        .http()
        .patch(`${ADMIN}/00000000-0000-7000-8000-000000000000`)
        .send({ name: 'X' })
        .expect(401);
    });

    it('lets judge.change_language list and update but not create', async () => {
      await send('get', '', editor).expect(200);
      const created = dataOf<LanguageAdminResponse>(
        await send('post', '', creator, newLanguage()).expect(201),
      );
      await send('patch', `/${created.id}`, editor, { name: 'Ok' }).expect(200);
      await send('post', '', editor, newLanguage()).expect(403);
    });

    it('lets judge.add_language create but not list or update', async () => {
      await send('post', '', creator, newLanguage()).expect(201);
      await send('get', '', creator).expect(403);
      await send('patch', '/00000000-0000-7000-8000-000000000000', creator, {
        name: 'X',
      }).expect(403);
    });

    it('refuses callers with no language permission', async () => {
      const outsider = await staff('judge.change_miscconfig');
      await send('get', '', outsider).expect(403);
      await send('post', '', outsider, newLanguage()).expect(403);
      await send('patch', '/00000000-0000-7000-8000-000000000000', outsider, {
        name: 'X',
      }).expect(403);
    });

    it('lets a superuser through every route', async () => {
      const { session } = await signedIn(api, unique('root'), {
        isSuperuser: true,
      });
      await send('get', '', session).expect(200);
      await send('post', '', session, newLanguage()).expect(201);
    });
  });
});
