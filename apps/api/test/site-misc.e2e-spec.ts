import { setupApiTest, errorCode, sessionCookie } from './setup';
import type { FlatpageResponse } from '../src/modules/site/public/dto/flatpage.response';
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
  });
}
