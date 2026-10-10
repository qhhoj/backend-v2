import type {
  PostDetailResponse,
  PostListItemResponse,
} from '../src/modules/blog/core/dto/post.response';
import type { VoteResponse } from '../src/modules/contributions/dto/vote.response';
import {
  createPost,
  postUrl,
  signedInWriter,
  writer,
} from './community-fixtures';
import { clearRateLimits } from './contest-fixtures';
import { createOrganization, organizationUrl } from './organization-fixtures';
import { authed, loginAs, createUserWith } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';
import { profileQueries } from '@libs/database/testing';

let api: ApiTest;

beforeAll(async () => {
  api = await setupApiTest();
});
afterAll(() => api.teardown());

// from blog-votes.e2e-spec.ts
{
  describe('blog votes', () => {
    beforeAll(() => api.reset());
    let userCount = 0;
    const person = (extra = {}) =>
      signedInWriter(api, `postvoter${(userCount += 1)}`, extra);
    const vote = (id: string, session: TestSession, score: number) =>
      authed(api.http().put(postUrl(id, '/vote')), session).send({ score });

    beforeAll(async () => {});
    beforeEach(() => clearRateLimits(api));

    it('votes, changes and withdraws, and shows the viewer their vote', async () => {
      const { user: author } = await person();
      const { session } = await person();
      const post = await createPost(api, { authors: [author._id] });
      expect(
        dataOf<VoteResponse>(await vote(post._id, session, 1).expect(200)),
      ).toEqual({ score: 1, viewerVote: 1 });
      expect(
        dataOf<VoteResponse>(await vote(post._id, session, -1).expect(200))
          .score,
      ).toBe(-1);
      expect(
        dataOf<PostDetailResponse>(
          await authed(api.http().get(postUrl(post._id)), session).expect(200),
        ),
      ).toMatchObject({ score: -1, viewerVote: -1 });
      expect(
        dataOf<VoteResponse>(await vote(post._id, session, 0).expect(200)),
      ).toEqual({ score: 0, viewerVote: 0 });
      await vote(post._id, session, 2).expect(400);
    });

    it('refuses votes on posts the voter cannot see', async () => {
      const { user: author } = await person();
      const { session: outsider } = await person();
      const { user: member, session: memberSession } = await person();
      const organization = await createOrganization(api, {}, [member._id]);
      const organizationPost = await createPost(api, {
        authors: [author._id],
        organization: organization._id,
      });
      const draft = await createPost(api, {
        authors: [author._id],
        visible: false,
      });
      await vote(organizationPost._id, outsider, 1)
        .expect(404)
        .expect(errorCode('not_found'));
      const scheduled = await createPost(api, {
        authors: [author._id],
        publishOn: new Date(Date.now() + 3_600_000),
      });
      await vote(draft._id, outsider, 1).expect(404);
      await vote(scheduled._id, outsider, 1).expect(404);
      await vote('nope', outsider, 1).expect(404);
      await vote(organizationPost._id, memberSession, 1).expect(200);
      expect(
        await api.blogVotes.countDocuments({ blog: { $in: [draft._id] } }),
      ).toBe(0);
    });

    it('refuses own posts, new and muted voters', async () => {
      const { user: author, session: authorSession } = await person();
      const post = await createPost(api, { authors: [author._id] });
      await vote(post._id, authorSession, 1).expect(403);
      await vote(
        post._id,
        (await person({ problemCount: 4 })).session,
        1,
      ).expect(403);
      await vote(post._id, (await person({ mute: true })).session, 1).expect(
        403,
      );
      await authed(api.http().put(postUrl(post._id, '/vote')), {
        cookie: '',
        csrf: '',
      })
        .send({ score: 1 })
        .expect(401);
    });

    it('answers 429 over the shared 60/min vote limit', async () => {
      const { user: author } = await person();
      const { session } = await person();
      const post = await createPost(api, { authors: [author._id] });
      for (let index = 0; index < 60; index += 1)
        await vote(post._id, session, index % 2 ? 1 : -1).expect(200);
      await vote(post._id, session, 1)
        .expect(429)
        .expect(errorCode('rate_limited'));
    });
  });
}

// from blog-moderation.e2e-spec.ts
{
  const MODERATION_URL = '/api/internal/admin/posts';

  describe('blog moderation list', () => {
    beforeAll(() => api.reset());
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

    beforeAll(async () => {});
    beforeEach(() => api.blogPosts.deleteMany({}));

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
      await createPost(api, {
        title: 'published',
        publishOn: hoursFromNow(-1),
      });
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
}

// from blog-posts.e2e-spec.ts
{
  describe('blog reads', () => {
    beforeAll(() => api.reset());
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

    beforeAll(async () => {});
    beforeEach(() => api.blogPosts.deleteMany({}));

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
      expect(await titles(url, bossSession)).toEqual([
        'published',
        'boss draft',
      ]);
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
          expect(read.hasSortStage).toBe(false);
        }
      }
    });

    it('lists organization posts sticky first for every kind of viewer', async () => {
      const { user: boss, session: bossSession } = await person();
      const { user: member, session: memberSession } = await person();
      const { session: staff } = await person({
        permissions: ['judge.edit_all_post'],
      });
      const organization = await createOrganization(
        api,
        { adminIds: [boss._id] },
        [member._id],
      );
      const inOrganization = {
        organization: organization._id,
        authors: [member._id],
      };
      await createPost(api, {
        ...inOrganization,
        title: 'new',
        publishOn: hourAgo(1),
      });
      await createPost(api, {
        ...inOrganization,
        title: 'old pinned',
        sticky: true,
        publishOn: hourAgo(9),
      });
      await createPost(api, {
        ...inOrganization,
        title: 'mid',
        publishOn: hourAgo(5),
      });
      const url = organizationUrl(organization.slug, '/posts');
      for (const session of [memberSession, bossSession, staff])
        expect(await titles(url, session)).toEqual([
          'old pinned',
          'new',
          'mid',
        ]);
    });

    it('shows each viewer their own vote on lists and detail', async () => {
      const { user: voter, session: voterSession } = await person();
      const { session: other } = await person();
      const post = await createPost(api, {
        authors: [voter._id],
        globalPost: true,
      });
      await api.blogVotes.create({
        blog: post._id,
        voter: voter._id,
        score: -1,
      });
      const listVote = async (session?: TestSession) => {
        const request = api.http().get('/api/internal/posts');
        const [item] = dataOf<PostListItemResponse[]>(
          await (session ? authed(request, session) : request).expect(200),
        );
        return item.viewerVote;
      };
      const detailVote = async (session?: TestSession) => {
        const request = api.http().get(postUrl(post._id));
        return dataOf<PostDetailResponse>(
          await (session ? authed(request, session) : request).expect(200),
        ).viewerVote;
      };
      expect([
        await listVote(voterSession),
        await listVote(other),
        await listVote(),
      ]).toEqual([-1, 0, 0]);
      expect([
        await detailVote(voterSession),
        await detailVote(other),
        await detailVote(),
      ]).toEqual([-1, 0, 0]);
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
      expect(
        await titles('/api/internal/posts?feed=all', memberSession),
      ).toEqual([]);
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
          expect(read.hasSortStage).toBe(false);
          expect(read.docsExamined).toBeLessThanOrEqual(11);
          expect(read.keysExamined).toBeLessThanOrEqual(11);
        }
      }
    });
  });
}
