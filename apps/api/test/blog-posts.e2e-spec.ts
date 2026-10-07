import { profileQueries } from '@libs/database/testing';
import type {
  PostDetailResponse,
  PostListItemResponse,
} from '../src/modules/blog/core/dto/post.response';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { createPost, postUrl, writer } from './community-fixtures';
import { authed, createUserWith, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('blog reads', () => {
  let api: ApiTest;
  let userCount = 0;
  const person = async (extra = {}) => {
    const user = await writer(api, `reader${(userCount += 1)}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const titles = async (url: string, session?: TestSession) => {
    const request = api.http().get(url);
    return dataOf<PostListItemResponse[]>(
      await (session ? authed(request, session) : request).expect(200),
    ).map((post) => post.title);
  };
  /** The server-side post queries `work` caused. */
  const blogReads = async (work: () => Promise<unknown>) =>
    (await profileQueries(api.db, work)).filter(
      ({ collection, operation }) =>
        collection === 'blogPosts' && operation === 'query',
    );
  const hourAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

  beforeAll(async () => {
    api = await setupApiTest();
  });
  beforeEach(() => api.blogPosts.deleteMany({}));
  afterAll(() => api.teardown());

  it('lists only what the viewer may see, newest first, sticky first on the newsfeed', async () => {
    const { user: author } = await person();
    const organization = await createOrganization(api);
    await createPost(api, {
      title: 'global old',
      authors: [author._id],
      globalPost: true,
      publishOn: hourAgo(3),
    });
    await createPost(api, {
      title: 'global sticky',
      authors: [author._id],
      globalPost: true,
      sticky: true,
      publishOn: hourAgo(5),
    });
    await createPost(api, {
      title: 'personal',
      authors: [author._id],
      publishOn: hourAgo(1),
    });
    await createPost(api, {
      title: 'draft',
      authors: [author._id],
      globalPost: true,
      visible: false,
    });
    await createPost(api, {
      title: 'future',
      authors: [author._id],
      globalPost: true,
      publishOn: hourAgo(-1),
    });
    await createPost(api, {
      title: 'org',
      authors: [author._id],
      organization: organization._id,
      globalPost: true,
    });
    expect(await titles('/api/internal/posts')).toEqual([
      'global sticky',
      'global old',
    ]);
    expect(await titles('/api/internal/posts?feed=all')).toEqual([
      'personal',
      'global old',
      'global sticky',
    ]);
  });

  it('serves a post to those who may see it, raw markdown to editors only', async () => {
    const { user: author, session: authorSession } = await person();
    const { session: stranger } = await person();
    const organization = await createOrganization(api);
    const { user: member, session: memberSession } = await person();
    await api.users.updateOne(
      { _id: member._id },
      { $push: { organizations: organization._id } },
    );
    const draft = await createPost(api, {
      authors: [author._id],
      visible: false,
      content: 'raw *md*',
    });
    const organizationPost = await createPost(api, {
      authors: [author._id],
      organization: organization._id,
    });
    await authed(api.http().get(postUrl(draft._id)), stranger).expect(404);
    await api.http().get(postUrl(draft._id)).expect(404);
    const own = dataOf<PostDetailResponse>(
      await authed(api.http().get(postUrl(draft._id)), authorSession).expect(
        200,
      ),
    );
    expect(own).toMatchObject({
      content: 'raw *md*',
      canEdit: true,
      canDelete: false,
    });
    await authed(
      api.http().get(postUrl(organizationPost._id)),
      stranger,
    ).expect(404);
    const asMember = dataOf<PostDetailResponse>(
      await authed(
        api.http().get(postUrl(organizationPost._id)),
        memberSession,
      ).expect(200),
    );
    expect(asMember).toMatchObject({
      content: null,
      canEdit: false,
      organization: { slug: organization.slug },
    });
    await api.http().get(postUrl('not-a-uuid')).expect(404);
  });

  it("shows another user's published personal posts on their tab, drafts to themselves", async () => {
    const { user: author, session: authorSession } = await person();
    const organization = await createOrganization(api);
    await createPost(api, { title: 'mine', authors: [author._id] });
    await createPost(api, {
      title: 'mine draft',
      authors: [author._id],
      visible: false,
      publishOn: hourAgo(2),
    });
    await createPost(api, {
      title: 'mine org',
      authors: [author._id],
      organization: organization._id,
    });
    const tab = `/api/internal/users/${author.username}/blog`;
    expect(await titles(tab)).toEqual(['mine']);
    expect(await titles(tab, authorSession)).toEqual(['mine', 'mine draft']);
    await api.http().get('/api/internal/users/nobody_here/blog').expect(404);
  });

  it('lists organization posts to members, admins and edit_all_post', async () => {
    const { user: boss, session: bossSession } = await person();
    const { user: member, session: memberSession } = await person();
    const { session: stranger } = await person();
    const { session: staff } = await person({
      permissions: ['judge.edit_all_post'],
    });
    const organization = await createOrganization(
      api,
      { adminIds: [boss._id] },
      [member._id],
    );
    await createPost(api, {
      title: 'published',
      organization: organization._id,
      authors: [member._id],
    });
    await createPost(api, {
      title: 'boss draft',
      organization: organization._id,
      authors: [boss._id],
      visible: false,
      publishOn: hourAgo(2),
    });
    await createPost(api, {
      title: 'other draft',
      organization: organization._id,
      authors: [member._id],
      visible: false,
      publishOn: hourAgo(3),
    });
    const url = organizationUrl(organization.slug, '/posts');
    expect(await titles(url, stranger)).toEqual([]);
    expect(await titles(url)).toEqual([]);
    expect(await titles(url, memberSession)).toEqual(['published']);
    expect(await titles(url, bossSession)).toEqual(['published', 'boss draft']);
    expect(await titles(url, staff)).toEqual([
      'published',
      'boss draft',
      'other draft',
    ]);
    for (const session of [memberSession, bossSession, staff]) {
      const reads = await blogReads(() => titles(url, session));
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) {
        expect(read.planSummary).toContain('IXSCAN');
        expect(read.planSummary).not.toContain('SORT');
      }
    }
  });

  it('keeps an unlisted organization private to its members while its page stays reachable', async () => {
    const { session: stranger } = await person();
    const { user: member, session: memberSession } = await person();
    const organization = await createOrganization(api, { isUnlisted: true }, [
      member._id,
    ]);
    await createPost(api, {
      title: 'secret',
      organization: organization._id,
      authors: [member._id],
      globalPost: true,
    });
    const url = organizationUrl(organization.slug, '/posts');
    expect(await titles(url, memberSession)).toEqual(['secret']);
    expect(await titles(url, stranger)).toEqual([]);
    expect(await titles(url)).toEqual([]);
    expect(await titles('/api/internal/posts?feed=all', memberSession)).toEqual(
      [],
    );
    await api
      .http()
      .get(organizationUrl('no-such-organization', '/posts'))
      .expect(404);
  });

  it('reads the newsfeed and a user tab through their indexes', async () => {
    const author = await createUserWith(api, 'prolific');
    for (let index = 0; index < 30; index += 1)
      await createPost(api, {
        authors: [author._id],
        publishOn: hourAgo(index + 1),
      });
    await createPost(api, { authors: [author._id], globalPost: true });
    for (const url of [
      '/api/internal/posts',
      '/api/internal/posts?feed=all',
      `/api/internal/users/${author.username}/blog`,
    ]) {
      const reads = await blogReads(() => titles(url));
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) {
        expect(read.planSummary).toContain('IXSCAN');
        expect(read.planSummary).not.toContain('SORT');
        expect(read.docsExamined).toBeLessThanOrEqual(11);
        expect(read.keysExamined).toBeLessThanOrEqual(11);
      }
    }
  });
});
