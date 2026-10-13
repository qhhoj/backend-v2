import { setupApiTest, errorCode, sessionCookie } from './setup';
import type { FlatpageResponse } from '../src/modules/site/public/dto/flatpage.response';
import {
  authed,
  createProblem,
  seedCatalog,
  createUserWith,
  loginAs,
} from './problem-fixtures';
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
  clearContributionQueue,
  writer,
} from './community-fixtures';
import { createOrganization } from './organization-fixtures';
import type { Catalog } from './problem-fixtures';
import { Queue as BullQueue } from 'bullmq';
import {
  ORGANIZATION_POINTS_JOB,
  CONTRIBUTION_POINTS_QUEUE,
} from '@libs/community';
import type {
  OrganizationPointsJob,
  ContributionPointsJob,
  VoteScore,
} from '@libs/community';
import { uuidStr, newId } from '@libs/database';
import type { User } from '@libs/database';
import type { ProfileResponse } from '../src/modules/users/profile/dto/profile.response';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { waitUntil } from '@libs/common/testing';
import { ProblemEvents } from '../src/modules/problems/core/problem.events';
import { VotesService } from '../src/modules/contributions/votes.service';
import { clearRateLimits } from './contest-fixtures';

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

describe('profile', () => {
  let userCount = 0;
  const person = async (extra: Partial<User> = {}) => {
    userCount += 1;
    const user = await createUserWith(api, `profile${userCount}`, extra);
    const session = await loginAs(api, user._id);
    return {
      user,
      patch: (body: object) =>
        authed(api.http().patch('/api/internal/profile'), session).send(body),
      get: () => authed(api.http().get('/api/internal/profile'), session),
    };
  };

  beforeAll(async () => {
    await api.reset();
    await seedCatalog(api);
  });

  it('gates about on five solved problems or staff, and on not being muted', async () => {
    await (await person({ problemCount: 4 })).patch({ about: 'x' }).expect(403);
    await (await person({ isStaff: true })).patch({ about: 'x' }).expect(200);
    await (
      await person({ problemCount: 50, mute: true })
    )
      .patch({ about: 'x' })
      .expect(403);
    const newcomer = await person({ problemCount: 0, about: 'kept' });
    await newcomer
      .patch({ about: 'kept', timezone: 'Asia/Ho_Chi_Minh' })
      .expect(200);
  });

  it('stores a personal appearance, returns it, replaces it as a whole and clears it with null', async () => {
    const { user, patch, get } = await person();
    expect(
      dataOf<ProfileResponse>(await get().expect(200)).appearance,
    ).toBeNull();

    const saved = dataOf<ProfileResponse>(
      await patch({
        appearance: { accent: 'ocean', glass: 30, glow: 100 },
      }).expect(200),
    );
    expect(saved.appearance).toEqual({ accent: 'ocean', glass: 30, glow: 100 });
    expect((await api.users.findOne({ _id: user._id }))!.appearance).toEqual({
      accent: 'ocean',
      glass: 30,
      glow: 100,
    });

    // Another field leaves it alone.
    const untouched = dataOf<ProfileResponse>(
      await patch({ siteTheme: 'dark' }).expect(200),
    );
    expect(untouched.appearance).toEqual({
      accent: 'ocean',
      glass: 30,
      glow: 100,
    });

    // A new object replaces the old one, boundaries included.
    const replaced = dataOf<ProfileResponse>(
      await patch({
        appearance: { accent: 'mono', glass: 0, glow: 0 },
      }).expect(200),
    );
    expect(replaced.appearance).toEqual({ accent: 'mono', glass: 0, glow: 0 });
    const edge = dataOf<ProfileResponse>(
      await patch({
        appearance: { accent: 'gold', glass: 100, glow: 100 },
      }).expect(200),
    );
    expect(edge.appearance).toEqual({ accent: 'gold', glass: 100, glow: 100 });

    // null is the one way back to the site's look; mode (siteTheme) is not part of it.
    const cleared = dataOf<ProfileResponse>(
      await patch({ appearance: null }).expect(200),
    );
    expect(cleared.appearance).toBeNull();
    expect(cleared.siteTheme).toBe('dark');
  });

  it('keeps roaming Bits off with one Bit until set, stores 1-5 and refuses other counts', async () => {
    const { user, patch, get } = await person();
    expect(dataOf<ProfileResponse>(await get().expect(200)).bitRoam).toEqual({
      on: false,
      count: 1,
    });

    const saved = dataOf<ProfileResponse>(
      await patch({ bitRoam: { on: true, count: 5 } }).expect(200),
    );
    expect(saved.bitRoam).toEqual({ on: true, count: 5 });
    expect((await api.users.findOne({ _id: user._id }))!.bitRoam).toEqual({
      on: true,
      count: 5,
    });

    // Off keeps the count; another field leaves both alone.
    await patch({ bitRoam: { on: false, count: 3 } }).expect(200);
    const untouched = dataOf<ProfileResponse>(
      await patch({ siteTheme: 'dark' }).expect(200),
    );
    expect(untouched.bitRoam).toEqual({ on: false, count: 3 });

    for (const bitRoam of [
      { on: true, count: 0 },
      { on: true, count: 6 },
      { on: true, count: 2.5 },
      { on: 'yes', count: 2 },
      { on: true },
      null,
    ])
      await patch({ bitRoam }).expect(400);
    expect(dataOf<ProfileResponse>(await get().expect(200)).bitRoam).toEqual({
      on: false,
      count: 3,
    });
  });

  it('reorders and leaves organizations, never adds one, never drops one it administers', async () => {
    const { user, patch } = await person();
    const [first, second, third] = [
      await createOrganization(api, {}, [user._id]),
      await createOrganization(api, {}, [user._id]),
      await createOrganization(api, { adminIds: [user._id] }),
    ];
    const reordered = dataOf<ProfileResponse>(
      await patch({ organizations: [second._id, first._id, third._id] }).expect(
        200,
      ),
    );
    expect(reordered.organizations.map((row) => row.id)).toEqual([
      second._id,
      first._id,
      third._id,
    ]);
    await patch({
      organizations: [
        second._id,
        first._id,
        third._id,
        (await createOrganization(api, { isOpen: false }))._id,
      ],
    }).expect(400);
    await patch({ organizations: [second._id, first._id] }).expect(409);
    const addBulk = jest.spyOn(BullQueue.prototype, 'addBulk');
    try {
      await patch({ organizations: [third._id] }).expect(200);
      const queued = addBulk.mock.calls
        .flatMap(([jobs]) => jobs)
        .filter((job) => job.name === ORGANIZATION_POINTS_JOB)
        .map((job) => (job.data as OrganizationPointsJob).organizationId);
      expect(queued.sort()).toEqual([first._id, second._id].sort());
    } finally {
      addBulk.mockRestore();
    }
    expect(
      (await api.users.findById(user._id).lean())!.organizations.map(uuidStr),
    ).toEqual([third._id]);
  });
});

describe('vote ledger', () => {
  let votes: VotesService;
  let queue: Queue<ContributionPointsJob>;
  let userCount = 0;
  const principalOf = (user: { _id: string; username: string }): Principal => ({
    userId: user._id,
    username: user.username,
    isSuperuser: false,
    isStaff: false,
    permissions: new Set(),
    organizationIds: [],
  });
  const person = async (extra = {}) =>
    principalOf(await writer(api, `voter${(userCount += 1)}`, extra));
  const storedVotes = async (commentId: string) =>
    (await api.commentVotes.find({ comment: commentId }).lean()).map(
      (row) => row.score,
    );
  const commentScore = async (commentId: string) =>
    (await api.comments.findById(commentId, { score: 1 }).lean())!.score;
  const castOn = (
    principal: Principal,
    commentId: string,
    ownerId: string,
    score: VoteScore,
  ) =>
    votes.cast(
      principal,
      { target: 'comment', targetId: commentId, ownerIds: [ownerId] },
      score,
    );

  beforeAll(async () => {
    await api.reset();
    votes = api.app.get(VotesService);
    queue = api.app.get(getQueueToken(CONTRIBUTION_POINTS_QUEUE));
  });
  beforeEach(async () => {
    await clearRateLimits(api);
    await clearContributionQueue(api);
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
  });

  it('changes and withdraws a vote', async () => {
    const author = await person();
    const voter = await person();
    const comment = await createComment(api, {
      page: { type: 'blog', id: (await createPost(api))._id },
      author: author.userId,
    });
    expect(await castOn(voter, comment._id, author.userId, 1)).toEqual({
      score: 1,
      viewerVote: 1,
    });
    expect((await castOn(voter, comment._id, author.userId, -1)).score).toBe(
      -1,
    );
    expect(await storedVotes(comment._id)).toEqual([-1]);
    expect((await castOn(voter, comment._id, author.userId, 0)).score).toBe(0);
    expect(await storedVotes(comment._id)).toEqual([]);
    expect((await castOn(voter, comment._id, author.userId, 0)).score).toBe(0);
  });

  it('keeps the score equal to the stored votes under parallel votes', async () => {
    const author = await person();
    const voters = await Promise.all(Array.from({ length: 8 }, () => person()));
    const comment = await createComment(api, {
      page: { type: 'blog', id: (await createPost(api))._id },
      author: author.userId,
    });
    await Promise.all(
      voters.map((voter) => castOn(voter, comment._id, author.userId, 1)),
    );
    expect(await commentScore(comment._id)).toBe(8);
    await Promise.all(
      ([1, -1, 0, -1, 1, -1] as const).map((score) =>
        castOn(voters[0], comment._id, author.userId, score),
      ),
    );
    const stored = await storedVotes(comment._id);
    expect(
      await api.commentVotes.countDocuments({
        comment: comment._id,
        voter: voters[0].userId,
      }),
    ).toBeLessThanOrEqual(1);
    expect(await commentScore(comment._id)).toBe(
      stored.reduce((sum, score) => sum + score, 0),
    );
    const post = await createPost(api, { authors: [author.userId] });
    await Promise.all(
      ([1, -1, 1, 0, -1] as const).map((score) =>
        votes.cast(
          voters[1],
          { target: 'blog', targetId: post._id, ownerIds: [author.userId] },
          score,
        ),
      ),
    );
    const postVotes = (await api.blogVotes.find({ blog: post._id }).lean()).map(
      (row) => row.score,
    );
    expect((await api.blogPosts.findById(post._id).lean())!.score).toBe(
      postVotes.reduce((sum, score) => sum + score, 0),
    );
  });

  it('refuses own votes, new and muted voters; staff vote without solves', async () => {
    const author = await person();
    const comment = await createComment(api, {
      page: { type: 'blog', id: (await createPost(api))._id },
      author: author.userId,
    });
    const refused = async (principal: Principal) =>
      expect(
        castOn(principal, comment._id, author.userId, 1),
      ).rejects.toMatchObject({ status: 403 });
    await refused(author);
    await refused(await person({ problemCount: 4 }));
    await refused(await person({ mute: true }));
    const staff = await person({ problemCount: 0, isStaff: true });
    await expect(
      castOn(staff, comment._id, author.userId, 1),
    ).resolves.toMatchObject({ score: 1 });
  });

  it('queues a recompute for the owners and for a suggester whose problem went public', async () => {
    const author = await person();
    const voter = await person();
    const comment = await createComment(api, {
      page: { type: 'blog', id: (await createPost(api))._id },
      author: author.userId,
    });
    await castOn(voter, comment._id, author.userId, 1);
    const suggester = await person();
    api.app
      .get(ProblemEvents)
      .emit('publicityChanged', newId(), suggester.userId);
    const waitingUsers = async () =>
      (await queue.getJobs(['waiting'])).map((job) => job.data.userId).sort();
    await waitUntil(
      async () =>
        JSON.stringify(await waitingUsers()) ===
        JSON.stringify([author.userId, suggester.userId].sort()),
    );
  });
});
