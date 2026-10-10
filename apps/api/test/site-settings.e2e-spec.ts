import { getModelToken } from '@nestjs/mongoose';
import { SettingsService } from '@libs/settings';
import { Setting, SettingRevision, newId } from '@libs/database';
import type { Model } from 'mongoose';
import { v7 } from 'uuid';
import {
  authed,
  createUserWith,
  loginAs,
  createProblem,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession, Catalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest, issueCodes } from './setup';
import type { ApiTest } from './setup';
import type { Test } from 'supertest';
import type { Permission } from '@libs/auth';
import type { FlatpageAdminResponse } from '../src/modules/site/admin/dto/flatpage-admin.response';
import type { FlatpageDeletedResponse } from '../src/modules/site/admin/dto/flatpage-revision.response';
import type { MiscConfigResponse } from '../src/modules/site/admin/dto/misc-config.response';
import type { SiteResponse } from '../src/modules/site/public/dto/site.response';
import { MAX_MARKDOWN_LENGTH } from '../src/modules/problems/core/dto/limits';
import { signedIn } from './ticket-fixtures';
import type { LanguageAdminResponse } from '../src/modules/problems/catalog/dto/language-admin.response';
import type { ProblemMetaResponse } from '../src/modules/problems/core/dto/problem-meta.response';
import type { User } from '@libs/database';
import { clearRateLimits } from './contest-fixtures';
import {
  commentPageUrl,
  createComment,
  createPost,
  writer,
} from './community-fixtures';
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
    let superuser: TestSession;
    let member: TestSession;
    let adminId: string;
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
      const ops = await createUserWith(api, 'ops', {
        permissions: ['judge.change_settings'],
      });
      adminId = ops._id;
      admin = await loginAs(api, ops._id);
      superuser = await loginAs(
        api,
        (await createUserWith(api, 'root', { isSuperuser: true }))._id,
      );
      member = await loginAs(api, (await createUserWith(api, 'member'))._id);
    });

    it('is for judge.change_settings holders and superusers only', async () => {
      await api.http().get(SETTINGS).expect(401);
      await api
        .http()
        .patch(`${SETTINGS}/mail.from`)
        .send({ value: 'a@b.test' })
        .expect(401);
      await authed(api.http().get(SETTINGS), member)
        .expect(403)
        .expect(errorCode('forbidden'));
      await patch('mail.from', 'a@b.test', member).expect(403);
      await authed(
        api.http().get(`${SETTINGS}/mail.from/revisions`),
        member,
      ).expect(403);
      await authed(api.http().get(SETTINGS), superuser).expect(200);
      await authed(api.http().get(SETTINGS), admin).expect(200);
      await api
        .http()
        .post(`${SETTINGS}/mail.from/revisions/${v7()}/restore`)
        .expect(401);
      await restore('mail.from', v7(), member).expect(403);
    });

    it('lists every registered setting with its default', async () => {
      const settings = await list();
      expect(settings.map((setting) => setting.key)).toEqual(
        expect.arrayContaining([
          'contest.officialMode',
          'contest.banAfterDisqualifications',
          'discord.webhooks',
          'mail.from',
          'mail.smtpUrl',
          'auth.pwnedApiUrl',
          'auth.google',
          'auth.github',
          'auth.facebook',
          'pdf.renderTimeoutMs',
          'pdf.maxBytes',
          'similarity.minPercent',
          'similarity.maxPairs',
          'similarity.maxSubmissions',
        ]),
      );
      expect(
        settings.find((setting) => setting.key === 'contest.officialMode'),
      ).toMatchObject({ value: false, isDefault: true, hasSecret: false });
    });

    it('ignores a stored row whose key left the registry', async () => {
      const rows = api.app.get<Model<Setting>>(getModelToken(Setting.name));
      await rows.collection.insertOne({
        _id: 'retired.key' as never,
        value: 'x',
        updatedAt: new Date(),
        updatedBy: null,
      });
      const keys = (await list()).map((setting) => setting.key);
      expect(keys).not.toContain('retired.key');
      expect([
        ...(await api.app.get(SettingsService).rows()).keys(),
      ]).not.toContain('retired.key');
      await rows.collection.deleteOne({ _id: 'retired.key' as never });
    });

    it('validates a patch and refuses null', async () => {
      const response = await patch('pdf.maxBytes', -1).expect(400);
      errorCode('validation_failed')(response);
      expect(
        (response.body as { error: { fields: object } }).error.fields,
      ).toHaveProperty('value');
      await patch('mail.from', null)
        .expect(400)
        .expect(errorCode('validation_failed'));
      await patch('contest.officialMode', 'yes').expect(400);
      await authed(api.http().patch(`${SETTINGS}/no.such.key`), admin)
        .send({ value: 1 })
        .expect(404)
        .expect(errorCode('not_found'));
    });

    it('applies a patch to readers at once and is default again once patched back', async () => {
      const view = dataOf<SettingView>(
        await patch('contest.banAfterDisqualifications', 2).expect(200),
      );
      expect(view).toMatchObject({ value: 2, isDefault: false });
      expect(
        api.app.get(SettingsService).get('contest.banAfterDisqualifications'),
      ).toBe(2);
      const reverted = dataOf<SettingView>(
        await patch('contest.banAfterDisqualifications', 0).expect(200),
      );
      expect(reverted).toMatchObject({ value: 0, isDefault: true });
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

    it('lists revisions with who changed what', async () => {
      const response = await authed(
        api
          .http()
          .get(`${SETTINGS}/auth.google/revisions`)
          .query({ pageSize: 10 }),
        admin,
      ).expect(200);
      const body = response.body as {
        data: Array<{ changedFields: string[]; actor: string | null }>;
        meta: { total: number };
      };
      expect(body.meta.total).toBe(2);
      expect(body.data[0].changedFields).toEqual(['clientId']);
      expect(body.data[0].actor).not.toBeNull();
    });

    it('answers every setting with its default, a secret default redacted', async () => {
      const settings = await list();
      for (const setting of settings) expect(setting).toHaveProperty('default');
      const google = settings.find((setting) => setting.key === 'auth.google')!;
      expect(google.default).toMatchObject({ clientSecret: { set: false } });
      const smtp = settings.find((setting) => setting.key === 'mail.smtpUrl')!;
      expect(smtp.default).toEqual({ set: false });
      expect(
        settings.find((setting) => setting.key === 'pdf.renderTimeoutMs'),
      ).toMatchObject({ default: 30_000 });
      expect(JSON.stringify(settings)).not.toMatch(
        /google-secret-1|s3cret-pass|tok-123/,
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

    it('restores an object setting and keeps its stored secret', async () => {
      await patch('auth.github', {
        enabled: true,
        clientId: 'gh-1',
        clientSecret: 'gh-secret-1',
      }).expect(200);
      await patch('auth.github', { clientId: 'gh-2' }).expect(200);
      const restored = dataOf<SettingView>(
        await restore(
          'auth.github',
          await newestRevisionId('auth.github'),
        ).expect(200),
      );
      expect(restored.value).toEqual({
        enabled: true,
        clientId: 'gh-1',
        clientSecret: { set: true },
      });
      expect(api.app.get(SettingsService).get('auth.github')).toMatchObject({
        clientId: 'gh-1',
        clientSecret: 'gh-secret-1',
      });
      expect(JSON.stringify(await list())).not.toContain('gh-secret-1');
      const [restoreRevision] = dataOf<
        Array<{ actor: string; before: unknown; after: unknown }>
      >(await revisionsOf('auth.github'));
      expect(restoreRevision.actor).toBe(adminId);
      expect(restoreRevision.after).toEqual(restored.value);
      expect(JSON.stringify(restoreRevision)).not.toContain('gh-secret-1');
    });

    it('refuses to restore a whole-secret setting with 409 and writes no revision', async () => {
      await patch('mail.smtpUrl', SMTP).expect(200);
      await patch('discord.webhooks', {
        default: 'https://discord.test/api/webhooks/tok-456',
      }).expect(200);
      for (const key of ['mail.smtpUrl', 'discord.webhooks']) {
        const revisionsBefore = await revisionTotal(key);
        const response = await restore(key, await newestRevisionId(key)).expect(
          409,
        );
        errorCode('secret_unrestorable')(response);
        expect(await revisionTotal(key)).toBe(revisionsBefore);
      }
      expect(api.app.get(SettingsService).get('mail.smtpUrl')).toBe(SMTP);
    });

    it('answers 404 for an unknown key, an unknown revision and a revision of another key', async () => {
      await restore(
        'no.such.key',
        await newestRevisionId('pdf.renderTimeoutMs'),
      )
        .expect(404)
        .expect(errorCode('not_found'));
      await restore('pdf.renderTimeoutMs', v7())
        .expect(404)
        .expect(errorCode('not_found'));
      await restore(
        'auth.google',
        await newestRevisionId('pdf.renderTimeoutMs'),
      )
        .expect(404)
        .expect(errorCode('not_found'));
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
    const site = async () =>
      dataOf<SiteResponse>(
        await api.http().get('/api/internal/site').expect(200),
      );
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

      it('strips foreign iframes and fixed overlays from page content', async () => {
        const created = dataOf<FlatpageAdminResponse>(
          await create({
            url: '/overlay',
            title: 'O',
            content:
              '<iframe src="https://evil.example/x"></iframe><div style="position:fixed;top:0;left:0;width:100vw;height:100vh">cover</div>ok',
          }).expect(201),
        );
        expect(created.contentHtml).not.toMatch(/evil\.example|<iframe|fixed/i);
        expect(created.contentHtml).toContain('ok');
      });

      it('answers flatpage reads with a private, revalidated cache header', async () => {
        await create({ url: '/cached', title: 'C', content: 'x' }).expect(201);
        const response = await publicPage('cached').expect(200);
        expect(response.headers['cache-control']).toBe('private, no-cache');
      });

      it('refuses a taken url, also spelled differently, with 409', async () => {
        await create({ url: '/dup', title: 'A', content: 'x' }).expect(201);
        await create({ url: 'dup/', title: 'B', content: 'x' })
          .expect(409)
          .expect(errorCode('conflict'));
        expect(await api.flatpages.countDocuments({ url: '/dup' })).toBe(1);
      });

      it('accepts a Unicode slug such as a Vietnamese one', async () => {
        const created = dataOf<FlatpageAdminResponse>(
          await create({
            url: '/giới-thiệu',
            title: 'Giới thiệu',
            content: 'x',
          }).expect(201),
        );
        expect(created.url).toBe('/giới-thiệu');
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

      it('validates the body fields', async () => {
        const response = await create({
          url: '/v',
          title: '',
          content: 'x'.repeat(100_001),
          registrationRequired: 'yes',
          extra: 1,
        }).expect(400);
        const fields = issuesOf(response).map((issue) => issue.split(':')[0]);
        expect(fields).toEqual(
          expect.arrayContaining([
            'title',
            'content',
            'registrationRequired',
            'extra',
          ]),
        );
        expect(await api.flatpages.countDocuments({ url: '/v' })).toBe(0);
      });

      it('lists by url with a total and reads one page with its source', async () => {
        const id = dataOf<FlatpageAdminResponse>(
          await create({ url: '/a-list', title: 'L', content: '*i*' }).expect(
            201,
          ),
        ).id;
        const list = (await send('get', '/pages', pageEditor).expect(200))
          .body as {
          data: Array<{ id: string; url: string; content?: string }>;
          meta: { total: number };
        };
        const urls = list.data.map(({ url }) => url);
        expect(urls).toEqual([...urls].sort());
        expect(list.meta.total).toBe(await api.flatpages.countDocuments());
        expect(list.data.find((row) => row.id === id)).not.toHaveProperty(
          'content',
        );
        const one = dataOf<FlatpageAdminResponse>(
          await send('get', `/pages/${id}`, pageEditor).expect(200),
        );
        expect(one).toMatchObject({
          content: '*i*',
          contentHtml: expect.stringContaining('<em>i</em>') as string,
        });
        await send('get', '/pages/not-an-id', pageEditor).expect(404);
        await send(
          'get',
          '/pages/019d0000-0000-7000-8000-000000000000',
          pageEditor,
        ).expect(404);
      });

      it('re-renders on a content change and keeps the html of a title-only change', async () => {
        const created = dataOf<FlatpageAdminResponse>(
          await create({ url: '/edit', title: 'Old', content: '**a**' }).expect(
            201,
          ),
        );
        const retitled = dataOf<FlatpageAdminResponse>(
          await send('patch', `/pages/${created.id}`, pageEditor, {
            title: 'New',
          }).expect(200),
        );
        expect(retitled).toMatchObject({
          title: 'New',
          contentHtml: created.contentHtml,
        });
        const rewritten = dataOf<FlatpageAdminResponse>(
          await send('patch', `/pages/${created.id}`, pageEditor, {
            content: '_b_',
          }).expect(200),
        );
        expect(rewritten.contentHtml).toContain('<em>b</em>');
        expect(rewritten.contentHtml).not.toContain('<strong>');
        const served = await publicPage('edit').expect(200);
        expect(dataOf<{ contentHtml: string }>(served).contentHtml).toBe(
          rewritten.contentHtml,
        );
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

    describe('page history and preview', () => {
      const NEVER_A_PAGE = '019d0000-0000-7000-8000-000000000000';
      const historian = async () =>
        signedIn(api, unique('historian'), {
          permissions: [
            'flatpages.add_flatpage',
            'flatpages.change_flatpage',
            'flatpages.delete_flatpage',
          ],
        });
      const create = (body: object) => send('post', '/pages', pageEditor, body);
      const edit = (id: string, body: object) =>
        send('patch', `/pages/${id}`, pageEditor, body);
      const revisions = (id: string, session: Session, query = '') =>
        send('get', `/pages/${id}/revisions${query}`, session);
      const preview = (content: string, session: Session = pageEditor) =>
        send('post', '/pages/render-preview', session, { content });
      type RevisionsBody = {
        data: Array<{
          action: string;
          editor: { id: string; username: string } | null;
          changes: Record<string, { before: unknown; after: unknown }>;
        }>;
        meta: { page: number; pageSize: number; total: number };
      };
      const bodyOf = (response: { body: unknown }) =>
        response.body as RevisionsBody;

      it('lists a deleted page history newest first with editor and changes', async () => {
        const { user, session } = await historian();
        const created = dataOf<FlatpageAdminResponse>(
          await send('post', '/pages', session, {
            url: `/${unique('history')}`,
            title: 'One',
            content: 'one',
          }).expect(201),
        );
        await send('patch', `/pages/${created.id}`, session, {
          title: 'Two',
          content: 'two',
        }).expect(200);
        await send('delete', `/pages/${created.id}`, session).expect(204);
        const { data, meta } = bodyOf(
          await revisions(created.id, session).expect(200),
        );
        expect(data.map(({ action }) => action)).toEqual([
          'delete',
          'edit',
          'create',
        ]);
        expect(data[0].editor).toEqual({
          id: user._id,
          username: user.username,
          rating: null,
        });
        expect(data[1].changes).toEqual({
          title: { before: 'One', after: 'Two' },
          content: { before: 'one', after: 'two' },
        });
        expect(data[2].changes.title.after).toBe('One');
        expect(meta).toEqual({ page: 1, pageSize: 20, total: 3 });
      });

      it('keeps another page out of the history', async () => {
        const mine = dataOf<FlatpageAdminResponse>(
          await create({
            url: `/${unique('mine')}`,
            title: 'M',
            content: 'm',
          }).expect(201),
        );
        const other = dataOf<FlatpageAdminResponse>(
          await create({
            url: `/${unique('other')}`,
            title: 'O',
            content: 'o',
          }).expect(201),
        );
        await edit(other.id, { title: 'O2' }).expect(200);
        const { data, meta } = bodyOf(
          await revisions(mine.id, pageEditor).expect(200),
        );
        expect(meta.total).toBe(1);
        expect(data.map(({ action }) => action)).toEqual(['create']);
      });

      it('paginates 20 revisions per page', async () => {
        const created = dataOf<FlatpageAdminResponse>(
          await create({
            url: `/${unique('long')}`,
            title: 'T0',
            content: 'c',
          }).expect(201),
        );
        for (let edits = 1; edits <= 20; edits++)
          await edit(created.id, { title: `T${edits}` }).expect(200);
        const first = bodyOf(
          await revisions(created.id, pageEditor).expect(200),
        );
        const second = bodyOf(
          await revisions(created.id, pageEditor, '?page=2').expect(200),
        );
        expect(first.data).toHaveLength(20);
        expect(first.meta).toEqual({ page: 1, pageSize: 20, total: 21 });
        expect(second.data.map(({ action }) => action)).toEqual(['create']);
      });

      it('answers an empty history for a well-formed id that was never a page', async () => {
        const { data, meta } = bodyOf(
          await revisions(NEVER_A_PAGE, pageEditor).expect(200),
        );
        expect(data).toEqual([]);
        expect(meta.total).toBe(0);
      });

      it('answers 400 for a malformed id on the history route', async () => {
        await revisions('not-an-id', pageEditor)
          .expect(400)
          .expect(errorCode('validation_failed'));
      });

      it('refuses the history to a user without change_flatpage', async () => {
        const adder = await staff('flatpages.add_flatpage');
        const created = dataOf<FlatpageAdminResponse>(
          await create({
            url: `/${unique('gated')}`,
            title: 'G',
            content: 'g',
          }).expect(201),
        );
        await revisions(created.id, adder).expect(403);
      });

      it('previews with the saved page sanitiser and strips script, iframe and handlers', async () => {
        const content =
          '**hi** <script>alert(1)</script><img src=x onerror=alert(2)><iframe src="https://evil.example"></iframe>';
        const saved = dataOf<FlatpageAdminResponse>(
          await create({
            url: `/${unique('preview')}`,
            title: 'P',
            content,
          }).expect(201),
        );
        const { html } = dataOf<{ html: string }>(
          await preview(content).expect(200),
        );
        expect(html).toBe(saved.contentHtml);
        expect(html).toContain('<strong>hi</strong>');
        expect(html).not.toMatch(/<script|<iframe|onerror/i);
      });

      it('refuses a preview to a user without change_flatpage, and a content over the limit', async () => {
        const adder = await staff('flatpages.add_flatpage');
        await preview('x', adder).expect(403);
        await preview('x'.repeat(MAX_MARKDOWN_LENGTH + 1)).expect(400);
      });

      it('rate limits previews per user and answers 429 with Retry-After', async () => {
        const { session } = await historian();
        for (let attempt = 0; attempt < 60; attempt++)
          await preview('x', session).expect(200);
        const refused = await preview('x', session)
          .expect(429)
          .expect(errorCode('rate_limited'))
          .expect(issueCodes(['rate_limited']));
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      });
    });

    describe('misc config', () => {
      const put = (key: string, body: object) =>
        send('put', `/config/${key}`, configEditor, body);

      it('creates then replaces a key in one row, allows an empty value, and shows both in GET /site at once', async () => {
        const created = dataOf<MiscConfigResponse>(
          await put('banner', { value: 'one' }).expect(200),
        );
        expect(created).toEqual({ key: 'banner', value: 'one' });
        expect((await site()).config.banner).toBe('one');
        await put('banner', { value: '' }).expect(200);
        expect((await site()).config.banner).toBe('');
        expect(await api.miscConfigs.countDocuments({ key: 'banner' })).toBe(1);
      });

      it('stores one row when two first writes of a key race', async () => {
        const results = await Promise.all([
          put('race', { value: 'a' }),
          put('race', { value: 'b' }),
        ]);
        expect(results.map(({ status }) => status)).toEqual([200, 200]);
        expect(await api.miscConfigs.countDocuments({ key: 'race' })).toBe(1);
      });

      it('refuses an oversized value, a null value, an unknown field and a bad key', async () => {
        await put('big', { value: 'x'.repeat(20_001) }).expect(400);
        await put('big', { value: null }).expect(400);
        await put('big', { value: 'x', extra: 1 }).expect(400);
        await put('k'.repeat(31), { value: 'x' }).expect(400);
        await put('bad%00key', { value: 'x' }).expect(400);
        expect(await api.miscConfigs.countDocuments({ key: 'big' })).toBe(0);
      });

      it('deletes a key, takes it out of GET /site at once and answers 404 when absent', async () => {
        await put('gone', { value: 'x' }).expect(200);
        await send('delete', '/config/gone', configEditor).expect(204);
        expect((await site()).config).not.toHaveProperty('gone');
        await send('delete', '/config/gone', configEditor).expect(404);
      });
    });
  });
}

// from languages-admin.e2e-spec.ts
{
  const ADMIN = '/api/internal/admin/languages';
  const META = '/api/internal/problems/meta';
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
    const issueFields = (response: { body: unknown }) =>
      (
        response.body as { error: { issues: Array<{ field: string }> } }
      ).error.issues.map(({ field }) => field);
    const listed = async (session: Session) =>
      dataOf<LanguageAdminResponse[]>(
        await send('get', '', session).expect(200),
      );
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
      editor = await staff('judge.change_language');
      creator = await staff('judge.add_language');
    });

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
        await send('post', '', creator, newLanguage({ key: 'Dup' })).expect(
          201,
        );
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
        await send('patch', `/${created.id}`, editor, { name: null }).expect(
          400,
        );
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
        await send('patch', '/not-a-uuid', editor, { name: 'Nope' }).expect(
          400,
        );
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
        await send('patch', `/${created.id}`, editor, { name: 'Ok' }).expect(
          200,
        );
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
    let catalog: Catalog;
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
        name: 'profile display badge',
        lockedCode: 'locked_in_official_contest',
        okStatus: 200,
        prepare: async (person) => {
          const badge = newId();
          await api.users.updateOne(
            { _id: person.id },
            { $set: { badges: [badge] } },
          );
          return patchProfile({ displayBadgeId: badge });
        },
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
      catalog = await seedCatalog(api);
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

    it('answers a locked badge change with 403 even when the badge is not the user own', async () => {
      const person = await newPerson();
      await clearRateLimits(api);
      await setMode(true);
      await authed(api.http().patch('/api/internal/profile'), person.session)
        .send({ displayBadgeId: newId() })
        .expect(403)
        .expect(errorCode('locked_in_official_contest'));
    });

    it('empties the recent comments of the home slice while locked and brings them back after the end time', async () => {
      const author = await newPerson();
      const reader = await newPerson();
      const post = await createPost(api);
      await createComment(api, {
        page: { type: 'blog', id: post._id },
        author: author.id,
      });
      const count = async (session?: TestSession) => {
        const request = api.http().get('/api/internal/home');
        const { recentComments } = dataOf<{ recentComments: unknown[] }>(
          await (session ? authed(request, session) : request).expect(200),
        );
        return recentComments.length;
      };
      await setMode(false);
      expect(await count()).toBeGreaterThan(0);
      expect(await count(reader.session)).toBeGreaterThan(0);
      await setMode(true);
      expect(await count()).toBe(0);
      expect(await count(reader.session)).toBe(0);
      await setMode(true, inAnHour());
      expect(await count()).toBe(0);
      await setMode(true, aMinuteAgo());
      expect(await count()).toBeGreaterThan(0);
      expect(await count(reader.session)).toBeGreaterThan(0);
    });

    it('tells the shell on GET /site, with the end instant, and stops telling it after the end time', async () => {
      const site = async () =>
        dataOf<{ officialMode: boolean; officialModeEndsAt: string | null }>(
          await api.http().get('/api/internal/site').expect(200),
        );
      expect(await site()).toMatchObject({
        officialMode: false,
        officialModeEndsAt: null,
      });
      await setMode(true);
      expect(await site()).toMatchObject({
        officialMode: true,
        officialModeEndsAt: null,
      });
      const endsAt = inAnHour();
      await setMode(true, endsAt);
      expect(await site()).toMatchObject({
        officialMode: true,
        officialModeEndsAt: endsAt,
      });
      await setMode(true, aMinuteAgo());
      expect(await site()).toMatchObject({
        officialMode: false,
        officialModeEndsAt: null,
      });
      await setMode(false, inAnHour());
      expect(await site()).toMatchObject({
        officialMode: false,
        officialModeEndsAt: null,
      });
    });

    it('refuses an end time without an offset or a date', async () => {
      await expect(
        api.setSetting('contest.officialModeEndsAt', '2026-10-10T08:00:00'),
      ).rejects.toThrow();
      await expect(
        api.setSetting('contest.officialModeEndsAt', 'soon'),
      ).rejects.toThrow();
      await expect(
        api.setSetting(
          'contest.officialModeEndsAt',
          '2026-10-10T08:00:00+07:00',
        ),
      ).resolves.toBeUndefined();
    });

    it('does not lock a profile form that resends the stored badge and order', async () => {
      const person = await newPerson();
      const badge = newId();
      const first = await createOrganization(api, {}, [person.id]);
      const second = await createOrganization(api, {}, [person.id]);
      await api.users.updateOne(
        { _id: person.id },
        { $set: { badges: [badge], displayBadgeId: badge } },
      );
      await setMode(true);
      await patchProfile({
        displayBadgeId: badge,
        organizations: [first._id, second._id],
        timezone: 'UTC',
      })(person.session).expect(200);
    });

    it('keeps tickets open while the mode is on', async () => {
      const problem = await createProblem(api, catalog, {
        code: `lockticket${(counter += 1)}`,
      });
      const person = await newPerson();
      await setMode(true);
      await authed(
        api.http().post(`/api/internal/problems/${problem.code}/tickets`),
        person.session,
      )
        .send({ title: 'Wrong answer', body: 'Sample 2 looks wrong' })
        .expect(201);
    });

    it('lets an organization administrator keep removing members while the mode is on', async () => {
      const admin = await newPerson();
      const member = await newPerson();
      const organization = await createOrganization(
        api,
        { adminIds: [admin.id], isOpen: true },
        [member.id],
      );
      await setMode(true);
      await authed(
        api.http().post(organizationUrl(organization.slug, '/kick')),
        admin.session,
      )
        .send({ userId: member.id })
        .expect(204);
    });
  });
}
