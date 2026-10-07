import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { profileQueries } from '@libs/database/testing';
import {
  createComment,
  createPost,
  signedInWriter,
} from './community-fixtures';
import { createOrganization } from './organization-fixtures';
import { createProblem, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('feeds', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
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
  afterAll(() => api.teardown());

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
    const cachedRead = await profileQueries(api.db, () => feed('blog', 'rss'));
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
