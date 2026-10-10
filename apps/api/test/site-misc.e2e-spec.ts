import { setupApiTest, errorCode, sessionCookie } from './setup';
import type { FlatpageResponse } from '../src/modules/site/public/dto/flatpage.response';
import type { SiteResponse } from '../src/modules/site/public/dto/site.response';
import { authed, createProblem, seedCatalog } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import type { ApiTest } from './setup';
import { signedIn } from './ticket-fixtures';
import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { profileQueries } from '@libs/database/testing';
import {
  createComment,
  createPost,
  signedInWriter,
} from './community-fixtures';
import { createOrganization } from './organization-fixtures';
import type { Catalog } from './problem-fixtures';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from health.e2e-spec.ts
{
  describe('GET /healthz', () => {
    beforeAll(() => api.reset());
    beforeAll(async () => {});

    it('returns ok', () =>
      api
        .http()
        .get('/healthz')
        .expect(200, { data: { status: 'ok' } }));
  });
}

// from api-docs.e2e-spec.ts
{
  describe('API reference (/api/docs)', () => {
    beforeAll(() => api.reset());
    beforeAll(async () => {});

    it('redirects /api/docs to the trailing-slash page', () =>
      api.http().get('/api/docs').expect(301).expect('location', '/api/docs/'));

    it('serves the Scalar reference pointing at the relative OpenAPI url', async () => {
      const response = await api.http().get('/api/docs/').expect(200);
      expect(response.headers['content-type']).toMatch(/text\/html/);
      expect(response.text).toContain('QHHOJ API');
      expect(response.text).toContain('/api/internal/openapi.json');
      expect(response.text).not.toMatch(/(src|href)="https?:\/\//);
      const script = /<script[^>]*src="([^"]+)"/.exec(response.text)?.[1];
      expect(script).toBe('js/scalar.js');
      await api.http().get('/api/docs/js/scalar.js').expect(200);
    });

    it('still serves the OpenAPI document it renders', async () => {
      const response = await api
        .http()
        .get('/api/internal/openapi.json')
        .expect(200);
      expect((response.body as { openapi: string }).openapi).toMatch(/^3\./);
    });
  });
}

// from social-settings.e2e-spec.ts
{
  const SOCIAL = '/api/internal/auth/social';
  const GITHUB = {
    enabled: true,
    clientId: 'gh-client',
    clientSecret: 'gh-secret',
  };

  /** The real OAuthProvidersService: no fake, the admin settings decide which providers exist. */
  describe('social login from settings', () => {
    beforeAll(() => api.reset());

    const listed = async () =>
      (
        (await api.http().get(`${SOCIAL}/providers`).expect(200)).body as {
          data: { providers: string[] };
        }
      ).data.providers;

    beforeAll(async () => {});

    it('lists github and starts the login once an admin enables it, and refuses it once disabled', async () => {
      expect(await listed()).toEqual([]);

      await api.setSetting('auth.github', GITHUB);
      expect(await listed()).toEqual(['github']);
      const start = await api.http().get(`${SOCIAL}/github/start`).expect(302);
      expect(start.headers.location).toMatch(
        /^https:\/\/github\.com\/login\/oauth\/authorize\?/,
      );
      expect(start.headers.location).toContain('client_id=gh-client');

      await api.setSetting('auth.github', { ...GITHUB, enabled: false });
      expect(await listed()).toEqual([]);
      await api
        .http()
        .get(`${SOCIAL}/github/start`)
        .expect(404)
        .expect(errorCode('not_found'));
      await api
        .http()
        .get(`${SOCIAL}/github/callback?code=c&state=s`)
        .expect(404)
        .expect(errorCode('not_found'));
    });
  });
}

// from site.e2e-spec.ts
{
  describe('site content', () => {
    beforeAll(() => api.reset());
    const page = (path: string) =>
      api.http().get(`/api/internal/pages/${path}`);

    beforeAll(async () => {
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

    describe('flatpages', () => {
      it('serves a page to anyone, with or without a trailing slash and nested', async () => {
        expect(
          dataOf<FlatpageResponse>(await page('about').expect(200)),
        ).toEqual({
          url: '/about',
          title: 'About',
          contentHtml: '<p>About us</p>',
          registrationRequired: false,
        });
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
          ).registrationRequired,
        ).toBe(true);
        expect(
          dataOf<FlatpageResponse>(
            await authed(page('members'), session).expect(200),
          ).contentHtml,
        ).toBe('<p>Members only</p>');
      });

      it('answers 401 to a signed-out reader whose session no longer exists, and sends a private no-cache header', async () => {
        const { session } = await signedIn(api, 'stale');
        const id = /qhhoj_session=([^;]+)/.exec(session.cookie)![1];
        const fresh = await authed(page('members'), session).expect(200);
        expect(fresh.headers['cache-control']).toBe('private, no-cache');
        await api.sessions.destroy(id);
        const stale = await api
          .http()
          .get('/api/internal/pages/members')
          .set('Cookie', sessionCookie(id))
          .expect(401)
          .expect(errorCode('unauthorized'));
        expect(JSON.stringify(stale.body)).not.toContain('Members only');
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

    describe('misc config', () => {
      it('serves the key/value config, never in a shared cache', async () => {
        await api.miscConfigs.create([
          { key: 'site_name', value: 'QHH OJ' },
          { key: 'footer', value: '' },
        ]);
        await api.resyncCatalog();
        const response = await api.http().get('/api/internal/site').expect(200);
        expect(response.headers['cache-control']).toMatch(/max-age=60/);
        expect(response.headers['cache-control']).not.toMatch(/public/);
        const site = dataOf<SiteResponse>(response);
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
        await api.miscConfigs.updateOne(
          { key: 'site_name' },
          { value: 'Renamed' },
        );
        await api.resyncCatalog();
        const site = dataOf<SiteResponse>(
          await api.http().get('/api/internal/site').expect(200),
        );
        expect(site.config.site_name).toBe('Renamed');
        await api.miscConfigs.deleteMany({});
        await api.resyncCatalog();
        expect(
          dataOf<SiteResponse>(
            await api.http().get('/api/internal/site').expect(200),
          ),
        ).toEqual({
          config: {},
          officialMode: false,
          officialModeEndsAt: null,
        });
      });
    });
  });
}

// from feeds.e2e-spec.ts
{
  describe('feeds', () => {
    beforeAll(() => api.reset());
    let catalog: Catalog;
    let userCount = 0;
    const person = (extra = {}) =>
      signedInWriter(api, `homey${(userCount += 1)}`, extra);
    // `buffer(true)` makes superagent keep the XML as text instead of a Buffer body.
    const feed = (kind: string, format: string) =>
      api
        .http()
        .get(`/api/internal/feeds/${kind}/${format}`)
        .buffer(true)
        .expect(200);

    beforeAll(async () => {
      catalog = await seedCatalog(api);
    });
    beforeEach(async () => {
      await Promise.all([
        api.comments.deleteMany({}),
        api.blogPosts.deleteMany({}),
      ]);
      const redis = api.app.get<Redis>(REDIS);
      const cached = await redis.keys('*feed:*');
      const slices = await redis.keys('home:*');
      if (cached.length + slices.length) await redis.del(...cached, ...slices);
    });

    it('keeps org-private and unpublished posts out of the feeds', async () => {
      const { user: author } = await person();
      const organization = await createOrganization(api);
      const shown = await createPost(api, { title: 'Shown post' });
      await createPost(api, {
        title: 'Org secret',
        organization: organization._id,
      });
      await createPost(api, { title: 'Draft secret', visible: false });
      await createPost(api, {
        title: 'Scheduled secret',
        publishOn: new Date(Date.now() + 3_600_000),
      });
      const organizationPost = await createPost(api, {
        title: 'Org page',
        organization: organization._id,
      });
      await createComment(api, {
        page: { type: 'blog', id: shown._id },
        author: author._id,
        bodyHtml: '<p>public words</p>',
      });
      await createComment(api, {
        page: { type: 'blog', id: organizationPost._id },
        author: author._id,
        bodyHtml: '<p>private words</p>',
      });
      await createComment(api, {
        page: { type: 'blog', id: shown._id },
        author: author._id,
        bodyHtml: '<p>hidden words</p>',
        hidden: true,
      });
      await createProblem(api, catalog, {
        code: 'feed_public',
        name: 'Feed Public',
      });
      await createProblem(api, catalog, {
        code: 'feed_private',
        name: 'Feed Private',
        isPublic: false,
      });
      const rss = await feed('blog', 'rss');
      expect(rss.headers['content-type']).toMatch(/^application\/rss\+xml/);
      expect(rss.text).toContain('Shown post');
      expect(rss.text).not.toMatch(
        /Org secret|Draft secret|Org page|Scheduled secret/,
      );
      const atom = await feed('blog', 'atom');
      expect(atom.headers['content-type']).toMatch(/^application\/atom\+xml/);
      expect(atom.text).toContain(`/post/${shown._id}`);
      expect(atom.text).toContain('<author><name>QHHOJ</name></author>');
      const comments = (await feed('comments', 'rss')).text;
      expect(comments).toContain('public words');
      expect(comments).not.toContain('private words');
      expect(comments).not.toContain('hidden words');
      const problems = (await feed('problems', 'atom')).text;
      expect(problems).toContain('Feed Public');
      expect(problems).not.toContain('Feed Private');
      const cachedRead = await profileQueries(api.db, () =>
        feed('blog', 'rss'),
      );
      expect(
        cachedRead.filter(({ collection }) => collection === 'blogPosts'),
      ).toEqual([]);
      await api.http().get('/api/internal/feeds/blog/json').expect(400);
    });

    it('escapes post titles and drops control characters in the XML', async () => {
      await createPost(api, {
        title: 'Tom & <script>alert(1)</script> \u0001\u0008end',
        contentHtml: '<p>]]></p>',
      });
      const rss = (await feed('blog', 'rss')).text;
      expect(rss).toContain(
        'Tom &amp; &lt;script&gt;alert(1)&lt;/script&gt; end',
      );
      for (const raw of ['<script>', '\u0001', '\u0008', ']]>'])
        expect(rss).not.toContain(raw);
      expect((rss.match(/<item>/g) ?? []).length).toBe(1);
    });
  });
}
