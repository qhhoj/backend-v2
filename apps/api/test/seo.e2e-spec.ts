import type Redis from 'ioredis';
import { REDIS } from '@libs/common';
import { createContest, hoursFromNow } from './contest-fixtures';
import { createPost } from './community-fixtures';
import { createProblem, createUserWith, seedCatalog } from './problem-fixtures';
import type { Catalog } from './problem-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('sitemap and link previews', () => {
  let api: ApiTest;
  let catalog: Catalog;
  const text = async (path: string, status = 200) =>
    (await api.http().get(path).buffer(true).expect(status)).text;
  const sitemap = (kind: string) =>
    text(`/api/internal/seo/sitemaps/${kind}/1`);

  beforeAll(async () => {
    api = await setupApiTest();
    catalog = await seedCatalog(api);
    const organization = await api.organizations.create({
      slug: 'secret-org',
      name: 'Secret',
      shortName: 'SEC',
    });
    await createProblem(api, catalog, { code: 'openprob' });
    await createProblem(api, catalog, { code: 'hiddenprob', isPublic: false });
    await createProblem(api, catalog, {
      code: 'orgprob',
      isOrganizationPrivate: true,
      organizations: [organization._id],
    });
    await createProblem(api, catalog, {
      code: 'goneprob',
      deletedAt: new Date(),
    });
    await createContest(api, { key: 'opencontest', name: 'Open Cup' });
    await createContest(api, { key: 'privcontest', isPrivate: true });
    await createContest(api, { key: 'ogcontest', ogImage: '/media/og.png' });
    await createContest(api, { key: 'draftcontest', isVisible: false });
    const author = await createUserWith(api, 'author');
    await createUserWith(api, 'ghostuser', { isUnlisted: true });
    await createUserWith(api, 'bannedone', { isActive: false });
    await createPost(api, {
      title: 'Public <post>',
      authors: [author._id],
    });
    await createPost(api, { title: 'Draft', visible: false });
    await createPost(api, { title: 'Future', publishOn: hoursFromNow(5) });
    await createPost(api, {
      title: 'Org post',
      organization: organization._id,
    });
  });

  afterAll(() => api.teardown());

  beforeEach(async () => {
    const redis = api.app.get<Redis>(REDIS);
    const keys = await redis.keys('*sitemap:*');
    if (keys.length) await redis.del(...keys);
  });

  it('lists only public problems, visible contests and listed users', async () => {
    const problems = await sitemap('problems');
    expect(problems).toContain('/problems/openprob<');
    for (const hidden of ['hiddenprob', 'orgprob', 'goneprob'])
      expect(problems).not.toContain(hidden);
    const contests = await sitemap('contests');
    expect(contests).toContain('/contests/opencontest<');
    expect(contests).not.toContain('privcontest');
    expect(contests).not.toContain('draftcontest');
    const users = await sitemap('users');
    expect(users).toContain('/users/author<');
    expect(users).not.toContain('ghostuser');
    expect(users).not.toContain('bannedone');
  });

  it('lists only published personal posts', async () => {
    const posts = (await sitemap('posts')).match(/<loc>/g) ?? [];
    expect(posts).toHaveLength(1);
  });

  it('lists a post published after the API started', async () => {
    const post = await createPost(api, { publishOn: new Date() });
    try {
      expect(await sitemap('posts')).toContain(`/blog/${post._id}<`);
    } finally {
      await api.blogPosts.deleteOne({ _id: post._id });
    }
  });

  it('indexes every kind and answers 404 past the last page', async () => {
    const index = await text('/api/internal/seo/sitemap.xml');
    for (const kind of ['pages', 'problems', 'contests', 'posts', 'users'])
      expect(index).toContain(`/sitemap-${kind}-1.xml</loc>`);
    expect(index).not.toContain('-2.xml');
    await text('/api/internal/seo/sitemaps/problems/2', 404);
  });

  it('serves a robots.txt that hides private areas and names the sitemap', async () => {
    const robots = await text('/api/internal/seo/robots.txt');
    expect(robots).toMatch(/^Disallow: \/admin$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots).toMatch(/^Sitemap: https?:\/\/.+\/sitemap\.xml$/m);
  });

  const preview = (path: string) =>
    text(`/api/internal/seo/preview?path=${encodeURIComponent(path)}`);

  it('renders escaped og tags for public pages', async () => {
    const problem = await preview('/problems/openprob');
    expect(problem).toContain(
      '<meta property="og:title" content="OPENPROB - QHHOJ">',
    );
    expect(problem).toContain('name="twitter:card"');
    expect(problem).toContain('property="og:image"');
    expect(await preview('/contest/opencontest')).toContain('Open Cup - QHHOJ');
    expect(await preview('/users/author')).toContain('author - QHHOJ');
    const posts = await api.blogPosts.find({ title: 'Public <post>' });
    const post = await preview(`/blog/${posts[0]._id}`);
    expect(post).toContain('Public &lt;post&gt; - QHHOJ');
    expect(post).not.toContain('<post>');
  });

  it("uses a contest's own preview image, made absolute, instead of the site image", async () => {
    const page = await preview('/contests/ogcontest');
    expect(page).toMatch(/property="og:image" content="[^"]+\/media\/og\.png"/);
    expect(page).not.toContain('/og-image.png');
    expect(await preview('/contests/opencontest')).toContain('/og-image.png');
  });

  it('gives a private or unknown page the same generic tags as no page', async () => {
    const generic = await preview('/nowhere');
    for (const path of [
      '/problems/hiddenprob',
      '/problems/orgprob',
      '/problems/missing',
      '/contests/privcontest',
      '/users/ghostuser',
      '/blog/not-an-id',
    ])
      expect(await preview(path)).toBe(generic);
    expect(generic).not.toContain('hiddenprob');
  });
});
