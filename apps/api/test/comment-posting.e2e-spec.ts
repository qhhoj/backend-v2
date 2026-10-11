import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { COMMENT_MAX_DEPTH, DISCORD_WEBHOOK_QUEUE } from '@libs/community';
import type { DiscordWebhookJob } from '@libs/community';
import { CommentPostingService } from '../src/modules/comments/posting/comment-posting.service';
import { CommentsRepository } from '../src/modules/comments/core/comments.repository';
import { RevisionsRepository } from '../src/modules/problems/core/revisions.repository';
import type { CommentResponse } from '../src/modules/comments/core/dto/comment.response';
import type { CommentRevisionResponse } from '../src/modules/comments/posting/dto/comment-revision.response';
import {
  commentPageUrl,
  commentUrl,
  createComment,
  createPost,
  ghost,
  writer,
} from './community-fixtures';
import { clearRateLimits } from './contest-fixtures';
import {
  contestProblem,
  createContest,
  joinParticipation,
  makeCurrent,
} from './contest-fixtures';
import {
  authed,
  createProblem,
  loginAs,
  seedCatalog,
} from './problem-fixtures';
import type { TestSession } from './problem-fixtures';
import { profileQueries } from '@libs/database/testing';
import { dataOf } from './submission-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('comment posting and editing', () => {
  let api: ApiTest;
  let discord: Queue<DiscordWebhookJob>;
  let userCount = 0;
  const person = async (extra = {}) => {
    const user = await writer(api, `commenter${(userCount += 1)}`, extra);
    return { user, session: await loginAs(api, user._id) };
  };
  const post = (postId: string, session: TestSession, body: object) =>
    authed(api.http().post(commentPageUrl('blog', postId)), session).send(body);
  const edit = (id: string, session: TestSession, body: string) =>
    authed(api.http().patch(commentUrl(id)), session).send({ body });

  beforeAll(async () => {
    api = await setupApiTest();
    await api.setSetting('discord.webhooks', {
      on_new_comment: 'http://127.0.0.1:9/hook',
    });
    discord = api.app.get(getQueueToken(DISCORD_WEBHOOK_QUEUE));
  });
  beforeEach(async () => {
    await clearRateLimits(api);
    await discord.drain();
  });
  afterAll(async () => {
    await discord.obliterate({ force: true });
    await api.teardown();
  });

  it('renders the body in the user style and announces comments on public pages', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const created = dataOf<CommentResponse>(
      await post(page._id, session, { body: '<b>raw</b> **bold**' }).expect(
        201,
      ),
    );
    expect(created.bodyHtml).toContain('&lt;b&gt;raw&lt;/b&gt;');
    expect(created.bodyHtml).toContain('<strong>bold</strong>');
    expect(created).toMatchObject({
      author: { id: user._id },
      depth: 0,
      parentId: null,
      score: 0,
    });
    const [job] = (await discord.getJobs(['waiting'])).map(
      (queued) => queued.data,
    );
    expect(job).toMatchObject({
      event: 'on_new_comment',
      message: {
        title: `New comment http://localhost:5173/post/${page._id}#comment-${created.id}`,
      },
    });
    const draft = await createPost(api, {
      authors: [user._id],
      visible: false,
    });
    await post(draft._id, session, { body: 'private note' }).expect(201);
    expect(await discord.getWaitingCount()).toBe(1);
  });

  it('refuses bad parents', async () => {
    const { user, session } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const elsewhere = await createPost(api);
    const foreign = await createComment(api, {
      page: { type: 'blog', id: elsewhere._id },
      author: user._id,
    });
    const hidden = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      hidden: true,
    });
    const old = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    await api.comments.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date(Date.now() - 366 * 86_400_000) } },
      { overwriteImmutable: true, timestamps: false },
    );
    await post(page._id, session, { body: 'x', parentId: foreign._id }).expect(
      404,
    );
    await post(page._id, session, { body: 'x', parentId: hidden._id }).expect(
      404,
    );
    await post(page._id, session, { body: 'x', parentId: 'nope' }).expect(400);
    await post(page._id, session, { body: 'x', parentId: old._id })
      .expect(403)
      .expect(errorCode('forbidden'));
    const reply = dataOf<CommentResponse>(
      await post(page._id, moderator, { body: 'x', parentId: old._id }).expect(
        201,
      ),
    );
    expect(reply).toMatchObject({ parentId: old._id, depth: 1 });
    let deepest = old;
    for (let depth = 1; depth <= COMMENT_MAX_DEPTH; depth += 1)
      deepest = await createComment(api, {
        page: { type: 'blog', id: page._id },
        author: user._id,
        parent: deepest,
      });
    const tooDeep = await post(page._id, moderator, {
      body: 'x',
      parentId: deepest._id,
    }).expect(400);
    expect(
      (tooDeep.body as { error: { fields: object } }).error.fields,
    ).toHaveProperty('parentId');
  });

  it('answers 401 when the user vanished between the session check and the write', async () => {
    const { user } = await person();
    const page = await createPost(api);
    const own = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    const principal = ghost(user);
    await api.users.deleteOne({ _id: user._id });
    const posting = api.app.get(CommentPostingService);
    await expect(
      posting.create(principal, { type: 'blog', key: page._id }, { body: 'x' }),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    await expect(posting.edit(principal, own._id, 'y')).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
    });
  });

  it('gates posting on solves, mute, locks, official mode, sign-in, page access and body size', async () => {
    const { session } = await person();
    const page = await createPost(api);
    await post(page._id, (await person({ problemCount: 4 })).session, {
      body: 'x',
    }).expect(403);
    await post(page._id, (await person({ mute: true })).session, {
      body: 'x',
    }).expect(403);
    await api
      .http()
      .post(commentPageUrl('blog', page._id))
      .send({ body: 'x' })
      .expect(401);
    await post((await createPost(api, { visible: false }))._id, session, {
      body: 'x',
    }).expect(404);
    await post(page._id, session, { body: '' }).expect(400);
    await post(page._id, session, { body: ' \n\t ' }).expect(400);
    await post(page._id, session, { body: 'x'.repeat(8193) }).expect(400);
    await api.commentLocks.create({ page: { type: 'blog', id: page._id } });
    await post(page._id, session, { body: 'x' }).expect(403);
    await post(
      page._id,
      (await person({ permissions: ['judge.override_comment_lock'] })).session,
      { body: 'x' },
    ).expect(201);
    const open = await createPost(api);
    await api.setSetting('contest.officialMode', true);
    try {
      await post(open._id, session, { body: 'x' }).expect(403);
    } finally {
      await api.setSetting('contest.officialMode', false);
    }
  });

  it('limits a user to 10 comments in 5 minutes', async () => {
    const { session } = await person();
    const page = await createPost(api);
    for (let index = 0; index < 10; index += 1)
      await post(page._id, session, { body: `comment ${index}` }).expect(201);
    await post(page._id, session, { body: 'one too many' })
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('limits a user to 20 comment edits in 5 minutes; a refused edit costs nothing', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    const conflict = jest
      .spyOn(api.app.get(CommentsRepository), 'updateBodyIfRevision')
      .mockResolvedValueOnce(false);
    await edit(comment._id, session, 'conflict').expect(409);
    conflict.mockRestore();
    for (let index = 0; index < 20; index += 1)
      await edit(comment._id, session, `edit ${index}`).expect(200);
    await edit(comment._id, session, 'one too many')
      .expect(429)
      .expect(errorCode('rate_limited'));
  });

  it('edits with a revision row per accepted edit, for the author and change_comment only', async () => {
    const { user, session } = await person();
    const { session: other } = await person();
    const { user: moderatorUser, session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      body: 'first',
    });
    const edited = dataOf<CommentResponse>(
      await edit(comment._id, session, '*second*').expect(200),
    );
    expect(edited).toMatchObject({ revisions: 1 });
    expect(edited.bodyHtml).toContain('<em>second</em>');
    await edit(comment._id, other, 'mine now').expect(403);
    await edit(comment._id, moderator, 'moderated').expect(200);
    const history = dataOf<CommentRevisionResponse[]>(
      await api.http().get(commentUrl(comment._id, '/revisions')).expect(200),
    );
    expect(history[0]).toMatchObject({
      editor: { id: moderatorUser._id },
    });
    expect(history[1].editor).toMatchObject({ id: user._id });
    expect(new Date(history[0].at) >= new Date(history[1].at)).toBe(true);
    expect(history.map((entry) => [entry.before, entry.after])).toEqual([
      ['*second*', 'moderated'],
      ['first', '*second*'],
    ]);
    const statuses = await Promise.all(
      Array.from({ length: 5 }, (_unused, index) =>
        edit(comment._id, session, `race ${index}`).then(
          (response) => response.status,
        ),
      ),
    );
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(
      true,
    );
    const stored = (await api.comments.findById(comment._id).lean())!;
    expect(stored.revisions).toBe(
      2 + statuses.filter((status) => status === 200).length,
    );
    expect(
      await api.revisions.countDocuments({
        entity: 'comment',
        entityId: comment._id,
      }),
    ).toBe(stored.revisions);
    await api.users.updateOne({ _id: user._id }, { mute: true });
    await edit(comment._id, session, 'muted').expect(403);
  });

  it('keeps hidden comments and their history to change_comment', async () => {
    const { user } = await person();
    const { session: moderator } = await person({
      permissions: ['judge.change_comment'],
    });
    const page = await createPost(api);
    const hidden = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      hidden: true,
    });
    await api.http().get(commentUrl(hidden._id, '/revisions')).expect(404);
    await authed(
      api.http().get(commentUrl(hidden._id, '/revisions')),
      moderator,
    ).expect(200);
    await edit(hidden._id, await loginAs(api, user._id), 'back').expect(404);
    await api.http().get(commentUrl(hidden._id)).expect(404);
    await authed(api.http().get(commentUrl(hidden._id)), moderator).expect(200);
  });

  it('refuses posting on a problem of a started contest, and edits no thread there', async () => {
    const { user, session } = await person();
    const problem = await createProblem(api, await seedCatalog(api), {
      code: 'post_conly',
      isPublic: false,
    });
    const contest = await createContest(api, {
      key: 'post_running',
      problems: [contestProblem(problem._id, 0)],
    });
    await makeCurrent(
      api,
      user._id,
      (await joinParticipation(api, contest._id, user._id))._id,
    );
    const existing = await createComment(api, {
      page: { type: 'problem', id: problem._id },
      author: user._id,
    });
    await authed(
      api.http().post(commentPageUrl('problem', 'post_conly')),
      session,
    )
      .send({ body: 'x' })
      .expect(403);
    await authed(api.http().patch(commentUrl(existing._id)), session)
      .send({ body: 'edited' })
      .expect(404);
  });

  it('serves the edit and its history through indexes', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    await edit(comment._id, session, 'once').expect(200);
    const operations = await profileQueries(api.db, async () => {
      await edit(comment._id, session, 'twice').expect(200);
      await api.http().get(commentUrl(comment._id, '/revisions')).expect(200);
    });
    const reads = operations.filter(
      ({ collection }) =>
        collection === 'comments' || collection === 'revisions',
    );
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
    expect(
      reads
        .filter(({ collection }) => collection === 'revisions')
        .every(({ planSummary }) => !planSummary.includes('SORT')),
    ).toBe(true);
  });

  it('applies an edit only against the revision count it read', async () => {
    const { user } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    const comments = api.app.get(CommentsRepository);
    expect(
      await comments.updateBodyIfRevision(comment._id, 0, {
        body: 'a',
        bodyHtml: '<p>a</p>',
      }),
    ).toBe(true);
    expect(
      await comments.updateBodyIfRevision(comment._id, 0, {
        body: 'b',
        bodyHtml: '<p>b</p>',
      }),
    ).toBe(false);
    expect(
      await comments.updateBodyIfRevision(comment._id, 1, {
        body: 'c',
        bodyHtml: '<p>c</p>',
      }),
    ).toBe(true);
    expect(await api.comments.findById(comment._id).lean()).toMatchObject({
      body: 'c',
      revisions: 2,
    });
  });

  it('hides a reply whose parent was hidden while it was written', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const parent = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
    });
    const repository = api.app.get(CommentsRepository);
    const create = repository.create.bind(repository);
    const spy = jest
      .spyOn(CommentsRepository.prototype, 'create')
      .mockImplementationOnce(async (fields) => {
        await api.comments.updateOne({ _id: parent._id }, { hidden: true });
        return create(fields);
      });
    try {
      const reply = dataOf<{ id: string }>(
        await post(page._id, session, {
          body: 'racing',
          parentId: parent._id,
        }).expect(201),
      );
      expect(await api.comments.findById(reply.id).lean()).toMatchObject({
        hidden: true,
      });
      expect(await discord.getWaitingCount()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the body unchanged when its revision row cannot be written', async () => {
    const { user, session } = await person();
    const page = await createPost(api);
    const comment = await createComment(api, {
      page: { type: 'blog', id: page._id },
      author: user._id,
      body: 'first',
    });
    const spy = jest
      .spyOn(RevisionsRepository.prototype, 'append')
      .mockRejectedValueOnce(new Error('revision store down'));
    try {
      await edit(comment._id, session, 'lost').expect(500);
    } finally {
      spy.mockRestore();
    }
    expect(await api.comments.findById(comment._id).lean()).toMatchObject({
      body: 'first',
      revisions: 0,
    });
  });
});
