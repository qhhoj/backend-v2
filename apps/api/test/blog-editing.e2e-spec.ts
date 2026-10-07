import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { ENV, REDIS } from '@libs/common';
import type { Env } from '@libs/common';
import {
  CONTRIBUTION_POINTS_QUEUE,
  DISCORD_WEBHOOK_QUEUE,
} from '@libs/community';
import type { ContributionPointsJob, DiscordWebhookJob } from '@libs/community';
import { newId, uuidStr } from '@libs/database';
import type { PostDetailResponse } from '../src/modules/blog/core/dto/post.response';
import {
  createComment,
  createPost,
  postUrl,
  writer,
} from './community-fixtures';
import { createOrganization } from './organization-fixtures';
import { authed, loginAs } from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('blog editing', () => {
  let api: ApiTest;
  let discord: Queue<DiscordWebhookJob>;
  let contributions: Queue<ContributionPointsJob>;
  let userCount = 0;
  const person = async (extra = {}) => {
    const user = await writer(api, `blogger${(userCount += 1)}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const create = (session: TestSession, body: object) =>
    authed(api.http().post('/api/internal/posts'), session).send({
      title: 'Title',
      content: 'Body',
      ...body,
    });
  const patch = (id: string, session: TestSession, body: object) =>
    authed(api.http().patch(postUrl(id)), session).send(body);

  beforeAll(async () => {
    api = await setupApiTest({
      env: { DISCORD_WEBHOOK_URLS: 'default=http://127.0.0.1:9/hook' },
    });
    discord = api.app.get(getQueueToken(DISCORD_WEBHOOK_QUEUE));
    contributions = api.app.get(getQueueToken(CONTRIBUTION_POINTS_QUEUE));
  });
  beforeEach(async () => {
    await discord.drain();
    await contributions.drain();
    const redis = api.app.get<Redis>(REDIS);
    const pending = await redis.keys('contribution-points:pending:*');
    if (pending.length) await redis.del(...pending);
  });
  afterAll(async () => {
    await discord.obliterate({ force: true });
    await contributions.obliterate({ force: true });
    await api.teardown();
  });

  it('creates a post with sanitized HTML, a revision and a Discord announcement', async () => {
    const { user, session } = await person();
    const created = dataOf<PostDetailResponse>(
      await create(session, {
        content: '<script>alert(1)</script>\n\n**bold**',
        visible: true,
      }).expect(201),
    );
    expect(created).toMatchObject({
      slug: user.username.toLowerCase(),
      visible: true,
      authors: [{ id: user._id }],
      canEdit: true,
    });
    expect(created.contentHtml).toContain('<strong>bold</strong>');
    expect(created.contentHtml).not.toContain('<script');
    expect(
      await api.revisions.countDocuments({
        entity: 'blogPost',
        entityId: created.id,
        action: 'create',
      }),
    ).toBe(1);
    const [job] = (await discord.getJobs(['waiting'])).map(
      (queued) => queued.data,
    );
    expect(job).toMatchObject({
      event: 'on_new_blogpost',
      message: {
        title: `New blog post http://localhost:5173/post/${created.id}`,
      },
    });
    await create(session, { visible: false }).expect(201);
    await create(session, {
      visible: true,
      publishOn: new Date(Date.now() + 3_600_000).toISOString(),
    }).expect(201);
    expect(await discord.getJobCounts('waiting')).toMatchObject({ waiting: 1 });
  });

  it('gates personal posts on 10 solved problems, not muted, and the flags on their permissions', async () => {
    await create((await person({ problemCount: 9 })).session, {})
      .expect(403)
      .expect(errorCode('forbidden'));
    await create((await person({ mute: true })).session, {}).expect(403);
    await create(
      (await person({ problemCount: 0, isSuperuser: true })).session,
      {},
    ).expect(201);
    const { session } = await person();
    await create(session, { globalPost: true }).expect(403);
    await create(session, { sticky: true }).expect(403);
    await create(
      (await person({ permissions: ['judge.mark_global_post'] })).session,
      { globalPost: true },
    ).expect(201);
    await create((await person({ permissions: ['judge.pin_post'] })).session, {
      sticky: true,
    }).expect(201);
    await create(session, { title: '' }).expect(400);
    await create(session, { publishOn: 'tomorrow' }).expect(400);
  });

  it('lets organization admins with edit_organization_post post for their organization only', async () => {
    const admin = await person({
      problemCount: 0,
      permissions: ['judge.edit_organization_post'],
    });
    const plainAdmin = await person({ problemCount: 50 });
    const member = await person({
      permissions: ['judge.edit_organization_post'],
    });
    const organization = await createOrganization(
      api,
      { adminIds: [admin.user._id, plainAdmin.user._id] },
      [member.user._id],
    );
    const created = dataOf<PostDetailResponse>(
      await create(admin.session, {
        organization: organization.slug,
        visible: true,
      }).expect(201),
    );
    expect(created).toMatchObject({
      organization: { slug: organization.slug },
      slug: organization.slug.toLowerCase(),
    });
    await create(plainAdmin.session, {
      organization: organization.slug,
    }).expect(403);
    await create(member.session, { organization: organization.slug }).expect(
      403,
    );
    await create(admin.session, { organization: 'no_such_org' }).expect(404);
    const mutedAdmin = await person({
      mute: true,
      permissions: ['judge.edit_organization_post'],
    });
    const mutedOrganization = await createOrganization(api, {
      adminIds: [mutedAdmin.user._id],
    });
    await create(mutedAdmin.session, {
      organization: mutedOrganization.slug,
    }).expect(403);
    expect(await discord.getJobCounts('waiting')).toMatchObject({ waiting: 0 });
  });

  it('locks blog writing for non-superusers in official contest mode', async () => {
    const env = api.app.get<Env>(ENV);
    const { session } = await person();
    const { session: root } = await person({ isSuperuser: true });
    env.officialContestMode = true;
    try {
      await create(session, {}).expect(403);
      await create(root, {}).expect(201);
    } finally {
      env.officialContestMode = false;
    }
  });

  it('edits for editors only, re-renders, records the diff and gates flags and authors', async () => {
    const { user, session } = await person();
    const { session: stranger } = await person();
    const { user: coauthor } = await person();
    const { session: staff } = await person({
      permissions: ['judge.edit_all_post'],
    });
    const post = await createPost(api, { authors: [user._id], content: 'old' });
    const edited = dataOf<PostDetailResponse>(
      await patch(post._id, session, {
        title: 'New title',
        content: '*new*',
      }).expect(200),
    );
    expect(edited).toMatchObject({ title: 'New title', content: '*new*' });
    expect(edited.contentHtml).toContain('<em>new</em>');
    const revision = (await api.revisions
      .findOne({ entityId: post._id, action: 'edit' })
      .lean())!;
    expect(Object.keys(revision.changes).sort()).toEqual(['content', 'title']);
    await patch(post._id, stranger, { title: 'x' }).expect(403);
    await patch(post._id, session, { sticky: true }).expect(403);
    await patch(post._id, session, { sticky: false }).expect(200);
    await patch(post._id, session, { authorIds: [coauthor._id] }).expect(403);
    await contributions.drain();
    await patch(post._id, staff, { authorIds: [coauthor._id] }).expect(200);
    expect(
      (await contributions.getJobs(['waiting']))
        .map((job) => job.data.userId)
        .sort(),
    ).toEqual([user._id, coauthor._id].sort());
    const authorsChange = (await api.revisions
      .findOne({ entityId: post._id, 'changes.authors': { $exists: true } })
      .lean())!;
    expect(authorsChange.changes.authors).toEqual({
      before: [user._id],
      after: [coauthor._id],
    });
    expect(
      (await api.blogPosts.findById(post._id).lean())!.authors.map(uuidStr),
    ).toEqual([coauthor._id]);
    await patch(post._id, staff, { title: null }).expect(400);
    const draft = await createPost(api, {
      authors: [user._id],
      visible: false,
    });
    await patch(draft._id, stranger, { title: 'x' }).expect(404);
  });

  it('refuses edits in official contest mode and to muted authors, and unknown author ids', async () => {
    const env = api.app.get<Env>(ENV);
    const { user, session } = await person();
    const { session: root } = await person({ isSuperuser: true });
    const { session: staff } = await person({
      permissions: ['judge.edit_all_post'],
    });
    const post = await createPost(api, { authors: [user._id], title: 'Kept' });
    env.officialContestMode = true;
    try {
      await patch(post._id, session, { title: 'Locked' }).expect(403);
      expect((await api.blogPosts.findById(post._id).lean())!.title).toBe(
        'Kept',
      );
      await patch(post._id, root, { title: 'Root' }).expect(200);
    } finally {
      env.officialContestMode = false;
    }
    const { user: muted, session: mutedSession } = await person({ mute: true });
    const mutedPost = await createPost(api, { authors: [muted._id] });
    await patch(mutedPost._id, mutedSession, { title: 'x' }).expect(403);
    await patch(post._id, staff, { authorIds: [newId()] })
      .expect(400)
      .expect(errorCode('validation_failed'));
  });

  it('edits only the fields sent, so a summary edit never rewrites content', async () => {
    const { user, session } = await person();
    const post = await createPost(api, { authors: [user._id], content: 'old' });
    await api.blogPosts.updateOne(
      { _id: post._id },
      { content: 'concurrent', contentHtml: '<p>SENTINEL</p>' },
    );
    const edited = dataOf<PostDetailResponse>(
      await patch(post._id, session, { summary: '*short*' }).expect(200),
    );
    expect(edited).toMatchObject({
      content: 'concurrent',
      contentHtml: '<p>SENTINEL</p>',
    });
    expect((await api.blogPosts.findById(post._id).lean())!.contentHtml).toBe(
      '<p>SENTINEL</p>',
    );
    expect(edited.summaryHtml).toContain('<em>short</em>');
  });

  it('limits post creates and edits to ten per hour per user, leaving the post unchanged', async () => {
    const { user, session } = await person();
    const { session: other } = await person();
    const post = await createPost(api, { authors: [user._id] });
    for (let index = 0; index < 5; index++)
      await create(session, { title: `Post ${index}` }).expect(201);
    for (let index = 0; index < 5; index++)
      await patch(post._id, session, { title: `Edit ${index}` }).expect(200);
    await create(session, { title: 'Over' })
      .expect(429)
      .expect(errorCode('rate_limited'));
    await patch(post._id, session, { title: 'Over' })
      .expect(429)
      .expect(errorCode('rate_limited'));
    expect(await api.blogPosts.countDocuments({ authors: user._id })).toBe(6);
    expect((await api.blogPosts.findById(post._id))!.title).toBe('Edit 4');
    await create(other, { title: 'Other' }).expect(201);
  });

  it('deletes with delete_blogpost, taking comments, votes and the lock along and recomputing their authors', async () => {
    const { user, session } = await person();
    const { user: deleter, session: deleterSession } = await person({
      permissions: ['judge.delete_blogpost'],
    });
    const { user: commenter } = await person();
    const post = await createPost(api, { authors: [user._id, deleter._id] });
    const page = { type: 'blog' as const, id: post._id };
    const comment = await createComment(api, { page, author: commenter._id });
    await api.commentVotes.create({
      comment: comment._id,
      voter: user._id,
      score: 1,
    });
    await api.blogVotes.create({
      blog: post._id,
      voter: commenter._id,
      score: 1,
    });
    await api.commentLocks.create({ page });
    await authed(api.http().delete(postUrl(post._id)), session).expect(403);
    await authed(api.http().delete(postUrl(post._id)), deleterSession).expect(
      204,
    );
    expect(
      await Promise.all([
        api.blogPosts.countDocuments({ _id: post._id }),
        api.comments.countDocuments({ 'page.id': post._id }),
        api.commentVotes.countDocuments({ comment: comment._id }),
        api.blogVotes.countDocuments({ blog: post._id }),
        api.commentLocks.countDocuments({ 'page.id': post._id }),
      ]),
    ).toEqual([0, 0, 0, 0, 0]);
    expect(
      (await contributions.getJobs(['waiting']))
        .map((job) => job.data.userId)
        .sort(),
    ).toEqual([user._id, deleter._id, commenter._id].sort());
    await authed(api.http().get(postUrl(post._id)), deleterSession).expect(404);
  });
});
