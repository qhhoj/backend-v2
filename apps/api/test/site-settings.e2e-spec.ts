import { getModelToken } from '@nestjs/mongoose';
import { SettingsService } from '@libs/settings';
import { Setting, SettingRevision } from '@libs/database';
import type { Model } from 'mongoose';
import {
  authed,
  createUserWith,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, issueCodes, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import type { Test } from 'supertest';
import type { Permission } from '@libs/auth';
import type { FlatpageAdminResponse } from '../src/modules/site/admin/dto/flatpage-admin.response';
import type { FlatpageDeletedResponse } from '../src/modules/site/admin/dto/flatpage-revision.response';
import { signedIn } from './ticket-fixtures';
import type { User } from '@libs/database';
import { clearRateLimits } from './contest-fixtures';
import { commentPageUrl, createPost, writer } from './community-fixtures';
import { createOrganization, organizationUrl } from './organization-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from settings.e2e-spec.ts
{
  const SETTINGS = '/api/internal/admin/settings';
  const SMTP = 'smtp://mailer:s3cret-pass@mail.test:587';

  interface SettingView {
    key: string;
    value: unknown;
    default: unknown;
    isDefault: boolean;
    hasSecret: boolean;
  }

  describe('/api/internal/admin/settings', () => {
    beforeAll(() => api.reset());
    let admin: TestSession;
    const patch = (key: string, value: unknown, session = admin) =>
      authed(api.http().patch(`${SETTINGS}/${key}`), session).send({ value });
    const restore = (key: string, revisionId: string, session = admin) =>
      authed(
        api.http().post(`${SETTINGS}/${key}/revisions/${revisionId}/restore`),
        session,
      );
    const revisionsOf = (key: string) =>
      authed(api.http().get(`${SETTINGS}/${key}/revisions`), admin).expect(200);
    const newestRevisionId = async (key: string) =>
      dataOf<Array<{ id: string }>>(await revisionsOf(key))[0].id;
    const revisionTotal = async (key: string) =>
      ((await revisionsOf(key)).body as { meta: { total: number } }).meta.total;
    const list = async () =>
      dataOf<SettingView[]>(
        await authed(api.http().get(SETTINGS), admin).expect(200),
      );

    beforeAll(async () => {
      const root = await createUserWith(api, 'root', { isSuperuser: true });
      admin = await loginAs(api, root._id);
    });

    it('lets only a superuser change the mail, admin role and sign-in settings', async () => {
      const ops = await createUserWith(api, 'ops', {
        permissions: ['judge.change_settings'],
      });
      const session = await loginAs(api, ops._id);
      for (const key of ['mail.smtpUrl', 'organization.adminRoleId'])
        await patch(key, '', session)
          .expect(403)
          .expect(issueCodes(['superuser_only']));
      await patch('auth.sessionMaxDays', 7).expect(200);
      await restore(
        'auth.sessionMaxDays',
        await newestRevisionId('auth.sessionMaxDays'),
        session,
      )
        .expect(403)
        .expect(issueCodes(['superuser_only']));
      await patch('pdf.maxBytes', 1_000_000, session).expect(200);
    });

    it('merges social login fields and never returns or stores a secret in clear', async () => {
      await patch('auth.google', {
        enabled: true,
        clientId: 'cid',
        clientSecret: 'google-secret-1',
      }).expect(200);
      await patch('mail.smtpUrl', SMTP).expect(200);
      await patch('discord.webhooks', {
        default: 'https://discord.test/api/webhooks/tok-123',
      }).expect(200);
      // the UI patches without the secret it cannot see: the stored one survives
      const merged = dataOf<SettingView>(
        await patch('auth.google', { clientId: 'cid-2' }).expect(200),
      );
      expect(merged.value).toEqual({
        enabled: true,
        clientId: 'cid-2',
        clientSecret: { set: true },
      });
      expect(api.app.get(SettingsService).get('auth.google').clientSecret).toBe(
        'google-secret-1',
      );

      const listed = JSON.stringify(await list());
      expect(listed).not.toMatch(/google-secret-1|s3cret-pass|tok-123/);
      const smtp = (await list()).find(
        (setting) => setting.key === 'mail.smtpUrl',
      )!;
      expect(smtp).toMatchObject({ value: { set: true }, hasSecret: true });

      const stored = JSON.stringify(
        await api.app
          .get<Model<Setting>>(getModelToken(Setting.name))
          .find()
          .lean(),
      );
      expect(stored).not.toMatch(/google-secret-1|s3cret-pass|tok-123/);
      const revisions = JSON.stringify(
        await api.app
          .get<Model<SettingRevision>>(getModelToken(SettingRevision.name))
          .find()
          .lean(),
      );
      expect(revisions).not.toMatch(/google-secret-1|s3cret-pass|tok-123/);

      const error = JSON.stringify(
        (
          await patch('discord.webhooks', {
            default: 'http://secret.example/tok-999',
          }).expect(400)
        ).body,
      );
      expect(error).not.toMatch(/secret\.example|tok-999/);
    });

    it('edits the Discord webhooks one event at a time, showing only masked targets', async () => {
      const HOOKS = '/api/internal/admin/discord-webhooks';
      const rows = async (request: Test) =>
        Object.fromEntries(
          dataOf<
            Array<{
              event: string;
              target: string | null;
              usesDefault: boolean;
            }>
          >(await request.expect(200)).map(({ event, ...row }) => [event, row]),
        );
      await patch('discord.webhooks', {
        default: 'https://discord.test/api/webhooks/tok-default',
      }).expect(200);
      const set = rows(
        authed(api.http().put(`${HOOKS}/on_new_ticket`), admin).send({
          url: 'https://discord.test/api/webhooks/tok-ticket',
        }),
      );
      expect(await set).toMatchObject({
        default: { target: 'discord.test/…ault', usesDefault: false },
        on_new_ticket: { target: 'discord.test/…cket', usesDefault: false },
        on_new_comment: { target: null, usesDefault: true },
      });
      expect(
        JSON.stringify(await rows(authed(api.http().get(HOOKS), admin))),
      ).not.toMatch(/tok-/);
      expect(api.app.get(SettingsService).get('discord.webhooks')).toEqual({
        default: 'https://discord.test/api/webhooks/tok-default',
        on_new_ticket: 'https://discord.test/api/webhooks/tok-ticket',
      });
      expect(
        await rows(authed(api.http().delete(`${HOOKS}/default`), admin)),
      ).toMatchObject({
        default: { target: null },
        on_new_comment: { target: null, usesDefault: false },
      });
      await authed(api.http().post(`${HOOKS}/on_new_comment/test`), admin)
        .expect(409)
        .expect(errorCode('webhook_unset'));
      await authed(
        api.http().post(`${HOOKS}/on_new_ticket/test`),
        admin,
      ).expect(204);
      const plain = await createUserWith(api, 'hooks-plain');
      await authed(api.http().get(HOOKS), await loginAs(api, plain._id)).expect(
        403,
      );
    });

    it('restores a revision: the value is back, the restore is a new revision and the querier sees it', async () => {
      await patch('pdf.renderTimeoutMs', 45_000).expect(200);
      const revisionsBefore = await revisionTotal('pdf.renderTimeoutMs');
      const restored = dataOf<SettingView>(
        await restore(
          'pdf.renderTimeoutMs',
          await newestRevisionId('pdf.renderTimeoutMs'),
        ).expect(200),
      );
      expect(restored).toMatchObject({
        value: 30_000,
        default: 30_000,
        isDefault: true,
      });
      expect(api.app.get(SettingsService).get('pdf.renderTimeoutMs')).toBe(
        30_000,
      );
      expect(await revisionTotal('pdf.renderTimeoutMs')).toBe(
        revisionsBefore + 1,
      );
    });
  });
}

// from site-admin.e2e-spec.ts
{
  const ADMIN = '/api/internal/admin/site';
  type Session = Awaited<ReturnType<typeof signedIn>>['session'];

  describe('site content administration', () => {
    beforeAll(() => api.reset());
    let counter = 0;
    const unique = (prefix: string) => `${prefix}${(counter += 1)}`;

    const staff = async (...permissions: Permission[]): Promise<Session> =>
      (await signedIn(api, unique('staff'), { permissions })).session;
    const send = (
      method: 'post' | 'patch' | 'put' | 'delete' | 'get',
      path: string,
      session: Session,
      body?: object,
    ): Test =>
      authed(api.http()[method](`${ADMIN}${path}`), session).send(body);
    const issuesOf = (response: { body: unknown }) =>
      (
        response.body as {
          error: { issues: Array<{ field: string; code: string }> };
        }
      ).error.issues.map(({ field, code }) => `${field}:${code}`);

    let pageEditor: Session;
    let configEditor: Session;

    beforeAll(async () => {
      pageEditor = await staff(
        'flatpages.add_flatpage',
        'flatpages.change_flatpage',
        'flatpages.delete_flatpage',
      );
      configEditor = await staff('judge.change_miscconfig');
    });

    describe('permissions', () => {
      type RouteRequest = {
        method: 'post' | 'patch' | 'put' | 'delete' | 'get';
        path: string;
        body?: object;
      };
      type Route = {
        name: string;
        permission: Permission;
        status: number;
        prepare: () => RouteRequest | Promise<RouteRequest>;
      };
      const page = async () =>
        (
          await api.flatpages.create({
            url: `/${unique('matrix')}`,
            title: 'Matrix',
          })
        )._id;
      const routes: Route[] = [
        {
          name: 'GET pages',
          permission: 'flatpages.change_flatpage',
          status: 200,
          prepare: () => ({ method: 'get', path: '/pages' }),
        },
        {
          name: 'GET pages/:id',
          permission: 'flatpages.change_flatpage',
          status: 200,
          prepare: async () => ({
            method: 'get',
            path: `/pages/${await page()}`,
          }),
        },
        {
          name: 'GET pages/deleted',
          permission: 'flatpages.change_flatpage',
          status: 200,
          prepare: () => ({ method: 'get', path: '/pages/deleted' }),
        },
        {
          name: 'GET pages/:id/revisions',
          permission: 'flatpages.change_flatpage',
          status: 200,
          prepare: async () => ({
            method: 'get',
            path: `/pages/${await page()}/revisions`,
          }),
        },
        {
          name: 'POST render-preview',
          permission: 'flatpages.change_flatpage',
          status: 200,
          prepare: () => ({
            method: 'post',
            path: '/pages/render-preview',
            body: { content: 'x' },
          }),
        },
        {
          name: 'POST pages',
          permission: 'flatpages.add_flatpage',
          status: 201,
          prepare: () => ({
            method: 'post',
            path: '/pages',
            body: { url: unique('new'), title: 'T', content: 'c' },
          }),
        },
        {
          name: 'PATCH pages/:id',
          permission: 'flatpages.change_flatpage',
          status: 200,
          prepare: async () => ({
            method: 'patch',
            path: `/pages/${await page()}`,
            body: { title: 'Changed' },
          }),
        },
        {
          name: 'DELETE pages/:id',
          permission: 'flatpages.delete_flatpage',
          status: 204,
          prepare: async () => ({
            method: 'delete',
            path: `/pages/${await page()}`,
          }),
        },
        {
          name: 'PUT config/:key',
          permission: 'judge.change_miscconfig',
          status: 200,
          prepare: () => ({
            method: 'put',
            path: `/config/${unique('k')}`,
            body: { value: 'v' },
          }),
        },
        {
          name: 'GET config/:key/revisions',
          permission: 'judge.change_miscconfig',
          status: 200,
          prepare: () => ({ method: 'get', path: '/config/any/revisions' }),
        },
        {
          name: 'DELETE config/:key',
          permission: 'judge.change_miscconfig',
          status: 204,
          prepare: async () => {
            const key = unique('d');
            await api.miscConfigs.create({ key, value: 'v' });
            return { method: 'delete', path: `/config/${key}` };
          },
        },
      ];

      it.each(routes)(
        '$name: 401 anonymous, 403 for any other site permission, only $permission passes',
        async ({ permission, status, prepare }) => {
          const anonymous = await prepare();
          await api
            .http()
            [anonymous.method](`${ADMIN}${anonymous.path}`)
            .send(anonymous.body)
            .expect(401);
          const others = (
            [
              'flatpages.add_flatpage',
              'flatpages.change_flatpage',
              'flatpages.delete_flatpage',
              'judge.change_miscconfig',
            ] as Permission[]
          ).filter((other) => other !== permission);
          const outsider = await staff(...others);
          const denied = await prepare();
          await send(denied.method, denied.path, outsider, denied.body).expect(
            403,
          );
          const allowed = await prepare();
          await send(
            allowed.method,
            allowed.path,
            await staff(permission),
            allowed.body,
          ).expect(status);
        },
      );

      it('lets a superuser through every route', async () => {
        const { session } = await signedIn(api, unique('root'), {
          isSuperuser: true,
        });
        for (const { prepare, status } of routes) {
          const route = await prepare();
          await send(route.method, route.path, session, route.body).expect(
            status,
          );
        }
      });
    });

    describe('flatpages', () => {
      const create = (body: object, session = pageEditor) =>
        send('post', '/pages', session, body);
      const publicPage = (url: string) =>
        api.http().get(`/api/internal/pages/${url}`);

      it('canonicalises the url, renders and sanitises the content, and serves it at once', async () => {
        const response = await create({
          url: 'guide/',
          title: 'Guide',
          content:
            '**bold** <script>alert(1)</script><img src=x onerror=alert(2)>',
          registrationRequired: true,
        }).expect(201);
        const created = dataOf<FlatpageAdminResponse>(response);
        expect(created).toMatchObject({
          url: '/guide',
          title: 'Guide',
          registrationRequired: true,
        });
        expect(created.contentHtml).toContain('<strong>bold</strong>');
        expect(created.contentHtml).not.toMatch(/<script|onerror/i);
        expect(created.content).toContain('<script>');
        await publicPage('guide').expect(401);
        const { session } = await signedIn(api, unique('reader'));
        const served = await authed(publicPage('guide'), session).expect(200);
        expect(dataOf<{ contentHtml: string }>(served).contentHtml).toBe(
          created.contentHtml,
        );
      });

      it.each([
        ['a parent segment', '../x'],
        ['only slashes', '///'],
        ['a control character', 'a\u0001b'],
        ['201 characters', 'x'.repeat(201)],
        ['a space', '/a b'],
        ['a query', '/a?x'],
        ['a fragment', '/a#y'],
        ['an escape', '/a%20b'],
        ['a url that only the leading slash makes too long', 'y'.repeat(200)],
      ])('refuses %s as a url with a 400 on url', async (_name, url) => {
        const response = await create({ url, title: 'T', content: 'x' }).expect(
          400,
        );
        expect(
          issuesOf(response).some((issue) => issue.startsWith('url:')),
        ).toBe(true);
      });

      it('changes nothing when a patch hits a taken url, a null, an unknown field or the render limit', async () => {
        await create({ url: '/taken', title: 'T', content: 'x' }).expect(201);
        const created = dataOf<FlatpageAdminResponse>(
          await create({
            url: '/atomic',
            title: 'Keep',
            content: 'keep',
          }).expect(201),
        );
        const patch = (body: object) =>
          send('patch', `/pages/${created.id}`, pageEditor, body);
        await patch({ url: 'taken/', title: 'Lost' }).expect(409);
        const nulled = await patch({ title: null }).expect(400);
        expect(issuesOf(nulled)).toContain('title:must_not_be_null');
        await patch({ nope: 1 }).expect(400);
        const heavy = await patch({
          content: `${'<div>'.repeat(600)}x`,
        }).expect(400);
        expect(heavy.body).toMatchObject({
          error: { code: 'validation_failed' },
        });
        expect(
          dataOf<FlatpageAdminResponse>(
            await send('get', `/pages/${created.id}`, pageEditor).expect(200),
          ),
        ).toMatchObject({ url: '/atomic', title: 'Keep', content: 'keep' });
        await send('patch', '/pages/not-an-id', pageEditor, {
          title: 'x',
        }).expect(404);
      });

      it('deletes, takes the page off the public route and records revisions of every write', async () => {
        const created = dataOf<FlatpageAdminResponse>(
          await create({ url: '/history', title: 'H', content: 'one' }).expect(
            201,
          ),
        );
        await send('patch', `/pages/${created.id}`, pageEditor, {
          content: 'two',
        }).expect(200);
        await send('patch', `/pages/${created.id}`, pageEditor, {
          content: 'two',
        }).expect(200);
        await send('delete', `/pages/${created.id}`, pageEditor).expect(204);
        await publicPage('history').expect(404);
        await send('delete', `/pages/${created.id}`, pageEditor).expect(404);
        const revisions = await api.revisions
          .find({ entity: 'flatpage', entityId: created.id })
          .sort({ createdAt: 1, _id: 1 })
          .lean();
        expect(revisions.map(({ action }) => action)).toEqual([
          'create',
          'edit',
          'delete',
        ]);
        expect(revisions[1].changes).toEqual({
          content: { before: 'one', after: 'two' },
        });
        expect(revisions[2].changes.url).toEqual({
          before: '/history',
          after: null,
        });
        const listed = await send('get', '/pages/deleted', pageEditor).expect(
          200,
        );
        expect(dataOf<FlatpageDeletedResponse[]>(listed)).toContainEqual({
          id: created.id,
          url: '/history',
          deletedAt: expect.any(String) as string,
        });
        const live = await create({
          url: '/still-here',
          title: 'S',
          content: 'x',
        });
        await send('get', '/pages/deleted', pageEditor).expect(
          (response: { body: unknown }) =>
            expect(JSON.stringify(response.body)).not.toContain(
              dataOf<FlatpageAdminResponse>(live).id,
            ),
        );
      });
    });

    describe('misc config', () => {
      const put = (key: string, body: object) =>
        send('put', `/config/${key}`, configEditor, body);

      it('stores one row when two first writes of a key race', async () => {
        const results = await Promise.all([
          put('race', { value: 'a' }),
          put('race', { value: 'b' }),
        ]);
        expect(results.map(({ status }) => status)).toEqual([200, 200]);
        expect(await api.miscConfigs.countDocuments({ key: 'race' })).toBe(1);
      });

      it('records each real change of a key, and keeps the history past a delete', async () => {
        const key = unique('notice');
        await put(key, { value: 'first' }).expect(200);
        await put(key, { value: 'first' }).expect(200);
        await put(key, { value: 'second' }).expect(200);
        await send('delete', `/config/${key}`, configEditor).expect(204);
        const history = dataOf<
          Array<{ action: string; changes: Record<string, unknown> }>
        >(
          await send('get', `/config/${key}/revisions`, configEditor).expect(
            200,
          ),
        );
        expect(history.map((row) => row.action)).toEqual([
          'delete',
          'edit',
          'create',
        ]);
        expect(history[1].changes.value).toEqual({
          before: 'first',
          after: 'second',
        });
      });
    });
  });
}

// from languages-admin.e2e-spec.ts
{
  const ADMIN = '/api/internal/admin/languages';
  type Session = Awaited<ReturnType<typeof signedIn>>['session'];

  describe('languages administration', () => {
    beforeAll(() => api.reset());
    let counter = 0;
    const unique = (prefix: string) => `${prefix}${(counter += 1)}`;

    const staff = async (...permissions: Permission[]): Promise<Session> =>
      (await signedIn(api, unique('staff'), { permissions })).session;
    const send = (
      method: 'get' | 'post' | 'patch',
      path: string,
      session: Session,
      body?: object,
    ): Test =>
      authed(api.http()[method](`${ADMIN}${path}`), session).send(body);
    const newLanguage = (overrides: object = {}) => ({
      key: unique('L'),
      name: 'Scheme',
      commonName: 'Scheme',
      ace: 'scheme',
      pygments: 'scheme',
      extension: 'scm',
      ...overrides,
    });

    let creator: Session;

    beforeAll(async () => {
      creator = await staff('judge.add_language');
    });

    describe('create', () => {
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
  });
}

// from official-mode.e2e-spec.ts
{
  interface Person {
    id: string;
    session: TestSession;
  }
  type Attempt = (session: TestSession) => Test;
  interface Row {
    name: string;
    /** The code a locked attempt answers (old locks keep `forbidden`). */
    lockedCode: string;
    okStatus: number;
    /** Seeds what the attempt needs (before the mode is switched on) and returns the attempt. */
    prepare: (person: Person) => Attempt | Promise<Attempt>;
  }

  /** Every lock introduced with `locked_in_official_contest` also carries it as `error.issues[0].code`; the older `forbidden` locks carry none. */
  const errorIssueCode =
    (code: string) =>
    ({ body }: { body: { error: { issues?: { code: string }[] } } }) => {
      if (code === 'forbidden') return;
      expect(body.error.issues?.[0]?.code).toBe(code);
    };

  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
  const aMinuteAgo = () => new Date(Date.now() - 60_000).toISOString();

  describe('official contest mode', () => {
    beforeAll(() => api.reset());
    let counter = 0;
    const setMode = async (on: boolean, endsAt = '') => {
      await api.setSetting('contest.officialMode', on);
      await api.setSetting('contest.officialModeEndsAt', endsAt);
    };
    const newPerson = async (extra: Partial<User> = {}): Promise<Person> => {
      counter += 1;
      const user = await writer(api, `locked${counter}`, extra);
      return { id: user._id, session: await loginAs(api, user._id) };
    };
    const patchProfile =
      (body: object): Attempt =>
      (session) =>
        authed(api.http().patch('/api/internal/profile'), session).send(body);

    const rows = (): Row[] => [
      {
        name: 'profile about',
        lockedCode: 'forbidden',
        okStatus: 200,
        prepare: () => patchProfile({ about: 'About me' }),
      },
      {
        name: 'profile first name',
        lockedCode: 'forbidden',
        okStatus: 200,
        prepare: () => patchProfile({ firstName: 'Grace' }),
      },
      {
        name: 'comment page',
        lockedCode: 'forbidden',
        okStatus: 200,
        prepare: async () => {
          const post = await createPost(api);
          return (session) =>
            authed(api.http().get(commentPageUrl('blog', post._id)), session);
        },
      },
      {
        name: 'blog post creation',
        lockedCode: 'forbidden',
        okStatus: 201,
        prepare: () => (session) =>
          authed(api.http().post('/api/internal/posts'), session).send({
            title: 'T',
            content: 'C',
          }),
      },
      {
        name: 'profile organization order',
        lockedCode: 'locked_in_official_contest',
        okStatus: 200,
        prepare: async (person) => {
          const first = await createOrganization(api, {}, [person.id]);
          const second = await createOrganization(api, {}, [person.id]);
          return patchProfile({ organizations: [second._id, first._id] });
        },
      },
      {
        name: 'organization join',
        lockedCode: 'locked_in_official_contest',
        okStatus: 204,
        prepare: async () => {
          const organization = await createOrganization(api, { isOpen: true });
          return (session) =>
            authed(
              api.http().post(organizationUrl(organization.slug, '/join')),
              session,
            );
        },
      },
      {
        name: 'organization leave',
        lockedCode: 'locked_in_official_contest',
        okStatus: 204,
        prepare: async (person) => {
          const organization = await createOrganization(api, { isOpen: true }, [
            person.id,
          ]);
          return (session) =>
            authed(
              api.http().post(organizationUrl(organization.slug, '/leave')),
              session,
            );
        },
      },
      {
        name: 'organization join request',
        lockedCode: 'locked_in_official_contest',
        okStatus: 201,
        prepare: async () => {
          const organization = await createOrganization(api, { isOpen: false });
          return (session) =>
            authed(
              api.http().post(organizationUrl(organization.slug, '/requests')),
              session,
            ).send({ reason: 'I would like to join' });
        },
      },
    ];

    /** One attempt in one mode state by one kind of person, each on a fresh person and fresh data. */
    const attempt = async (
      row: Row,
      mode: { on: boolean; endsAt?: string },
      expected: 'locked' | 'open',
      extra: Partial<User> = {},
    ) => {
      const person = await newPerson(extra);
      const run = await row.prepare(person);
      await clearRateLimits(api);
      await setMode(mode.on, mode.endsAt);
      const response = run(person.session);
      if (expected === 'locked')
        await response
          .expect(403)
          .expect(errorCode(row.lockedCode))
          .expect(errorIssueCode(row.lockedCode));
      else await response.expect(row.okStatus);
    };

    beforeAll(async () => {
      await seedCatalog(api);
    });
    afterEach(() => setMode(false));

    it.each(rows())(
      'locks $name while the mode is on, until its end time, and not for superusers',
      async (row) => {
        await attempt(row, { on: true }, 'locked');
        await attempt(row, { on: true, endsAt: inAnHour() }, 'locked');
        await attempt(row, { on: true }, 'open', { isSuperuser: true });
        await attempt(row, { on: true, endsAt: aMinuteAgo() }, 'open');
        await attempt(row, { on: false }, 'open');
      },
    );
  });
}

describe('GET /api/internal/site', () => {
  afterEach(() => api.setSetting('site.timeZone', 'Asia/Ho_Chi_Minh'));

  it('serves the site time zone setting, so the app reads and types dates in it', async () => {
    await api.setSetting('site.timeZone', 'Asia/Tokyo');
    const response = await api.http().get('/api/internal/site').expect(200);
    expect(dataOf(response)).toMatchObject({ timeZone: 'Asia/Tokyo' });
  });
});
