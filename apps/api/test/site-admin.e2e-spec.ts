import type { Test } from 'supertest';
import type { Permission } from '@libs/auth';
import type { FlatpageAdminResponse } from '../src/modules/site/admin/dto/flatpage-admin.response';
import type { MiscConfigResponse } from '../src/modules/site/admin/dto/misc-config.response';
import type {
  NavigationItemResponse,
  SiteResponse,
} from '../src/modules/site/public/dto/site.response';
import { authed } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { signedIn } from './ticket-fixtures';

const ADMIN = '/api/internal/admin/site';
type Session = Awaited<ReturnType<typeof signedIn>>['session'];

describe('site content administration', () => {
  let api: ApiTest;
  let counter = 0;
  const unique = (prefix: string) => `${prefix}${(counter += 1)}`;

  const staff = async (...permissions: Permission[]): Promise<Session> =>
    (await signedIn(api, unique('staff'), { permissions })).session;
  const send = (
    method: 'post' | 'patch' | 'put' | 'delete' | 'get',
    path: string,
    session: Session,
    body?: object,
  ): Test => authed(api.http()[method](`${ADMIN}${path}`), session).send(body);
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
  let navigationEditor: Session;
  let configEditor: Session;

  beforeAll(async () => {
    api = await setupApiTest();
    pageEditor = await staff(
      'flatpages.add_flatpage',
      'flatpages.change_flatpage',
      'flatpages.delete_flatpage',
    );
    navigationEditor = await staff('judge.change_navigationbar');
    configEditor = await staff('judge.change_miscconfig');
  });
  afterAll(() => api.teardown());

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
    const entry = async () =>
      (
        await api.navigationItems.create({
          key: unique('m'),
          label: 'M',
          path: '/m',
          order: 1,
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
        name: 'POST navigation',
        permission: 'judge.change_navigationbar',
        status: 201,
        prepare: () => ({
          method: 'post',
          path: '/navigation',
          body: { key: unique('n'), label: 'N', path: '/n', order: 1 },
        }),
      },
      {
        name: 'PATCH navigation/:id',
        permission: 'judge.change_navigationbar',
        status: 200,
        prepare: async () => ({
          method: 'patch',
          path: `/navigation/${await entry()}`,
          body: { label: 'Changed' },
        }),
      },
      {
        name: 'DELETE navigation/:id',
        permission: 'judge.change_navigationbar',
        status: 204,
        prepare: async () => ({
          method: 'delete',
          path: `/navigation/${await entry()}`,
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
            'judge.change_navigationbar',
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

    it.each([
      ['a parent segment', '../x'],
      ['only slashes', '///'],
      ['a control character', 'a\u0001b'],
      ['201 characters', 'x'.repeat(201)],
      ['a url that only the leading slash makes too long', 'y'.repeat(200)],
    ])('refuses %s as a url with a 400 on url', async (_name, url) => {
      const response = await create({ url, title: 'T', content: 'x' }).expect(
        400,
      );
      expect(issuesOf(response).some((issue) => issue.startsWith('url:'))).toBe(
        true,
      );
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
        await create({ url: '/atomic', title: 'Keep', content: 'keep' }).expect(
          201,
        ),
      );
      const patch = (body: object) =>
        send('patch', `/pages/${created.id}`, pageEditor, body);
      await patch({ url: 'taken/', title: 'Lost' }).expect(409);
      const nulled = await patch({ title: null }).expect(400);
      expect(issuesOf(nulled)).toContain('title:must_not_be_null');
      await patch({ nope: 1 }).expect(400);
      const heavy = await patch({ content: `${'<div>'.repeat(600)}x` }).expect(
        400,
      );
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
    });
  });

  describe('navigation', () => {
    const create = (body: object) =>
      send('post', '/navigation', navigationEditor, body);
    const entryBody = (key: string, extra: object = {}) => ({
      key,
      label: key,
      path: `/${key}`,
      regex: `^/${key}`,
      order: 1,
      ...extra,
    });
    const createdEntry = async (key: string, extra: object = {}) =>
      dataOf<NavigationItemResponse>(
        await create(entryBody(key, extra)).expect(201),
      );

    it('shows a new entry in GET /site right away, and edits and deletes too', async () => {
      const created = await createdEntry('live', { hidden: true });
      expect(created).toMatchObject({
        key: 'live',
        hidden: true,
        parentId: null,
      });
      expect((await site()).navigation).toContainEqual(created);
      await send('patch', `/navigation/${created.id}`, navigationEditor, {
        label: 'Renamed',
        order: 7,
      }).expect(200);
      expect(
        (await site()).navigation.find(({ id }) => id === created.id),
      ).toMatchObject({
        label: 'Renamed',
        order: 7,
      });
      await send(
        'delete',
        `/navigation/${created.id}`,
        navigationEditor,
      ).expect(204);
      expect((await site()).navigation.map(({ id }) => id)).not.toContain(
        created.id,
      );
      await send(
        'delete',
        `/navigation/${created.id}`,
        navigationEditor,
      ).expect(404);
    });

    it.each([
      ['an uncompilable regex', { regex: '(' }, 'regex:invalid_regex'],
      ['a 501 character regex', { regex: 'x'.repeat(501) }, 'regex:'],
      [
        'a javascript: path',
        { path: 'javascript:alert(1)' },
        'path:invalid_path',
      ],
      [
        'a protocol-relative path',
        { path: '//evil.example' },
        'path:invalid_path',
      ],
      ['a 21 character label', { label: 'x'.repeat(21) }, 'label:'],
      ['an 11 character key', { key: 'x'.repeat(11) }, 'key:'],
      ['a negative order', { order: -1 }, 'order:'],
      [
        'an unknown parent',
        { parentId: '019d0000-0000-7000-8000-000000000000' },
        'parentId:parent_unknown',
      ],
      ['a malformed parent', { parentId: 'nope' }, 'parentId:parent_unknown'],
    ])('refuses %s with a 400', async (_name, change, issue) => {
      const response = await create(entryBody(unique('bad'), change)).expect(
        400,
      );
      expect(issuesOf(response).some((found) => found.startsWith(issue))).toBe(
        true,
      );
    });

    it('refuses a taken key with 409', async () => {
      await createdEntry('same');
      await create(entryBody('same')).expect(409).expect(errorCode('conflict'));
      expect(await api.navigationItems.countDocuments({ key: 'same' })).toBe(1);
    });

    it('refuses cycles, moves an entry to the root with null and a parent delete with children with 409', async () => {
      const root = await createdEntry('cyc-root');
      const child = await createdEntry('cyc-child', { parentId: root.id });
      const leaf = await createdEntry('cyc-leaf', { parentId: child.id });
      const move = (id: string, body: object) =>
        send('patch', `/navigation/${id}`, navigationEditor, body);
      expect(
        issuesOf(await move(root.id, { parentId: root.id }).expect(400)),
      ).toContain('parentId:parent_cycle');
      expect(
        issuesOf(await move(root.id, { parentId: leaf.id }).expect(400)),
      ).toContain('parentId:parent_cycle');
      expect(
        issuesOf(await move(child.id, { parentId: leaf.id }).expect(400)),
      ).toContain('parentId:parent_cycle');
      await send('delete', `/navigation/${child.id}`, navigationEditor)
        .expect(409)
        .expect(errorCode('conflict'));
      await send('delete', `/navigation/${root.id}`, navigationEditor).expect(
        409,
      );
      expect((await site()).navigation.map(({ id }) => id)).toEqual(
        expect.arrayContaining([root.id, child.id, leaf.id]),
      );
      const moved = dataOf<NavigationItemResponse>(
        await move(child.id, { parentId: null }).expect(200),
      );
      expect(moved.parentId).toBeNull();
      expect(
        (await site()).navigation.find(({ id }) => id === child.id)!.parentId,
      ).toBeNull();
      await move(child.id, { label: null }).expect(400);
      await send('delete', `/navigation/${root.id}`, navigationEditor).expect(
        204,
      );
      await send('delete', `/navigation/${leaf.id}`, navigationEditor).expect(
        204,
      );
      await send('delete', `/navigation/${child.id}`, navigationEditor).expect(
        204,
      );
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
