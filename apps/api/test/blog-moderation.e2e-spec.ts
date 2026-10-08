import type { PostListItemResponse } from '../src/modules/blog/core/dto/post.response';
import { createOrganization } from './organization-fixtures';
import { profileQueries } from '@libs/database/testing';
import { createPost, writer } from './community-fixtures';
import { authed, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

const MODERATION_URL = '/api/internal/admin/posts';

describe('blog moderation list', () => {
  let api: ApiTest;
  let userCount = 0;
  const moderator = async () => {
    const user = await writer(api, `moderator${(userCount += 1)}`, {
      permissions: ['judge.edit_all_post'],
    });
    return loginAs(api, user._id);
  };
  const plainUser = async () => {
    const user = await writer(api, `plain${(userCount += 1)}`);
    return loginAs(api, user._id);
  };
  const hoursFromNow = (hours: number) =>
    new Date(Date.now() + hours * 3_600_000);
  const listing = (query: string, session: TestSession) =>
    authed(api.http().get(`${MODERATION_URL}?${query}`), session);
  const titlesOf = async (query: string, session: TestSession) =>
    dataOf<PostListItemResponse[]>(
      await listing(query, session).expect(200),
    ).map((post) => post.title);

  beforeAll(async () => {
    api = await setupApiTest();
  });
  beforeEach(() => api.blogPosts.deleteMany({}));
  afterAll(() => api.teardown());

  it('lists hidden posts: personal and organization drafts, newest first, nothing published or scheduled', async () => {
    const session = await moderator();
    const author = await writer(api, `author${(userCount += 1)}`);
    const organization = await createOrganization(api);
    await createPost(api, {
      title: 'personal draft',
      authors: [author._id],
      visible: false,
      publishOn: hoursFromNow(-2),
    });
    await createPost(api, {
      title: 'organization draft',
      authors: [author._id],
      organization: organization._id,
      visible: false,
      publishOn: hoursFromNow(-1),
    });
    await createPost(api, {
      title: 'scheduled',
      authors: [author._id],
      publishOn: hoursFromNow(1),
    });
    await createPost(api, {
      title: 'published',
      authors: [author._id],
      publishOn: hoursFromNow(-3),
    });
    expect(await titlesOf('state=hidden', session)).toEqual([
      'organization draft',
      'personal draft',
    ]);
  });

  it('lists scheduled posts only, the latest publishOn first', async () => {
    const session = await moderator();
    await createPost(api, { title: 'sooner', publishOn: hoursFromNow(1) });
    await createPost(api, { title: 'later', publishOn: hoursFromNow(5) });
    await createPost(api, {
      title: 'draft',
      visible: false,
      publishOn: hoursFromNow(9),
    });
    await createPost(api, { title: 'published', publishOn: hoursFromNow(-1) });
    expect(await titlesOf('state=scheduled', session)).toEqual([
      'later',
      'sooner',
    ]);
  });

  it('carries the organization slug and leaves the markdown sources out of rows', async () => {
    const session = await moderator();
    const organization = await createOrganization(api);
    await createPost(api, {
      title: 'organization draft',
      slug: organization.slug,
      organization: organization._id,
      visible: false,
      content: 'raw *md*',
      summary: 'raw summary',
    });
    const [row] = dataOf<PostListItemResponse[]>(
      await listing('state=hidden', session).expect(200),
    );
    expect(row).toMatchObject({ slug: organization.slug, visible: false });
    expect('content' in row).toBe(false);
    expect('summary' in row).toBe(false);
  });

  it('reads both lists through the moderation index', async () => {
    const session = await moderator();
    for (let index = 0; index < 30; index += 1) {
      await createPost(api, {
        visible: false,
        publishOn: hoursFromNow(-index),
      });
      await createPost(api, { publishOn: hoursFromNow(index + 1) });
    }
    for (const query of ['state=hidden', 'state=scheduled']) {
      const operations = await profileQueries(api.db, () =>
        listing(query, session).expect(200),
      );
      const reads = operations.filter(
        ({ collection, operation }) =>
          collection === 'blogPosts' && operation === 'query',
      );
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) {
        expect(read.planSummary).toContain('IXSCAN');
        expect(read.planSummary).not.toContain('COLLSCAN');
        expect(read.hasSortStage).toBe(false);
        expect(read.docsExamined).toBeLessThanOrEqual(11);
        expect(read.keysExamined).toBeLessThanOrEqual(11);
      }
    }
  });

  it('refuses users without edit_all_post and anonymous visitors', async () => {
    await listing('state=hidden', await plainUser()).expect(403);
    await api.http().get(`${MODERATION_URL}?state=hidden`).expect(401);
  });

  it('requires state to be hidden or scheduled', async () => {
    const session = await moderator();
    await listing('', session)
      .expect(400)
      .expect(errorCode('validation_failed'));
    await listing('state=published', session)
      .expect(400)
      .expect(errorCode('validation_failed'));
  });
});
