import type { FlatpageResponse } from '../src/modules/site/dto/flatpage.response';
import type { SiteResponse } from '../src/modules/site/dto/site.response';
import { authed } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, sessionCookie, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { signedIn } from './ticket-fixtures';

describe('site content', () => {
  let api: ApiTest;
  const page = (path: string) => api.http().get(`/api/internal/pages/${path}`);

  beforeAll(async () => {
    api = await setupApiTest();
    await api.flatpages.create([
      {
        url: '/about',
        title: 'About',
        content: 'x',
        contentHtml: '<p>About us</p>',
      },
      { url: '/help/faq', title: 'FAQ', contentHtml: '<p>Questions</p>' },
      {
        url: '/members',
        title: 'Members',
        contentHtml: '<p>Members only</p>',
        registrationRequired: true,
      },
      { url: '/secret', title: 'Secret', contentHtml: '<p>s</p>' },
    ]);
  });
  afterAll(() => api.teardown());

  describe('flatpages', () => {
    it('serves a page to anyone, with or without a trailing slash and nested', async () => {
      expect(dataOf<FlatpageResponse>(await page('about').expect(200))).toEqual(
        {
          url: '/about',
          title: 'About',
          contentHtml: '<p>About us</p>',
        },
      );
      expect(
        dataOf<FlatpageResponse>(await page('about/').expect(200)).url,
      ).toBe('/about');
      expect(
        dataOf<FlatpageResponse>(await page('help/faq').expect(200)).title,
      ).toBe('FAQ');
    });

    it('refuses anonymous readers of registration-required pages without content', async () => {
      const response = await page('members')
        .expect(401)
        .expect(errorCode('unauthorized'));
      expect(JSON.stringify(response.body)).not.toContain('Members only');
      const { session } = await signedIn(api, 'reader');
      expect(
        dataOf<FlatpageResponse>(
          await authed(page('members'), session).expect(200),
        ).contentHtml,
      ).toBe('<p>Members only</p>');
    });

    it('answers 404 for unknown pages and a missing slug, and the same page for odd spellings', async () => {
      await page('nope').expect(404).expect(errorCode('not_found'));
      await api.http().get('/api/internal/pages/').expect(404);
      await api.http().get('/api/internal/pages').expect(404);
      await page('a'.repeat(5000)).expect(404);
      expect(
        dataOf<FlatpageResponse>(await page('/about').expect(200)).url,
      ).toBe('/about');
    });

    it('normalizes odd urls: dot segments never reach another page', async () => {
      await page('%2e%2e/secret').expect(404);
      await page('%2e%2e').expect(404);
      await page('about/%00').expect(404);
    });
  });

  describe('navigation bar and misc config', () => {
    it('serves ordered navigation items and the key/value config, never in a shared cache', async () => {
      const parent = await api.navigationItems.create({
        key: 'problems',
        label: 'Problems',
        path: '/problems',
        regex: '^/problems',
        order: 2,
      });
      await api.navigationItems.create({
        key: 'home',
        label: 'Home',
        path: '/',
        regex: '^/$',
        order: 1,
      });
      await api.navigationItems.create({
        key: 'archive',
        label: 'Archive',
        path: '/archive',
        regex: '^/archive',
        order: 1,
        parentId: parent._id,
        hidden: true,
      });
      await api.miscConfigs.create([
        { key: 'site_name', value: 'QHH OJ' },
        { key: 'footer', value: '' },
      ]);
      await api.resyncCatalog();
      const response = await api.http().get('/api/internal/site').expect(200);
      expect(response.headers['cache-control']).toMatch(/max-age=60/);
      expect(response.headers['cache-control']).not.toMatch(/public/);
      const site = dataOf<SiteResponse>(response);
      expect(site.navigation.map((item) => item.key)).toEqual([
        'archive',
        'home',
        'problems',
      ]);
      expect(site.navigation[0]).toMatchObject({
        parentId: parent._id,
        hidden: true,
        regex: '^/archive',
      });
      expect(site.navigation[1]).toMatchObject({
        parentId: null,
        hidden: false,
        path: '/',
      });
      expect(site.config).toEqual({ site_name: 'QHH OJ', footer: '' });
    });

    it('is not shared-cacheable when it carries a refreshed session cookie', async () => {
      const { session } = await signedIn(api, 'old-session');
      const id = /qhhoj_session=([^;]+)/.exec(session.cookie)![1];
      await api.sessions.update(id, {
        cookieIssuedAt: Date.now() - 25 * 60 * 60 * 1000,
      });
      const response = await api
        .http()
        .get('/api/internal/site')
        .set('Cookie', sessionCookie(id))
        .expect(200);
      expect(String(response.headers['set-cookie'])).toContain(
        `qhhoj_session=${id}`,
      );
      expect(response.headers['cache-control']).not.toMatch(/public/);
    });

    it('follows changes after a resync and reads empty once the rows are gone', async () => {
      await api.navigationItems.updateOne({ key: 'home' }, { label: 'Start' });
      await api.miscConfigs.updateOne(
        { key: 'site_name' },
        { value: 'Renamed' },
      );
      await api.resyncCatalog();
      const site = dataOf<SiteResponse>(
        await api.http().get('/api/internal/site').expect(200),
      );
      expect(site.navigation.find((item) => item.key === 'home')!.label).toBe(
        'Start',
      );
      expect(site.config.site_name).toBe('Renamed');
      await api.navigationItems.deleteMany({});
      await api.miscConfigs.deleteMany({});
      await api.resyncCatalog();
      expect(
        dataOf<SiteResponse>(
          await api.http().get('/api/internal/site').expect(200),
        ),
      ).toEqual({ navigation: [], config: {} });
    });
  });
});
