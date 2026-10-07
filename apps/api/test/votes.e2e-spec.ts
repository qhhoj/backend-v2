import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { CONTRIBUTION_POINTS_QUEUE } from '@libs/community';
import type { ContributionPointsJob, VoteScore } from '@libs/community';
import { newId } from '@libs/database';
import { ProblemEvents } from '../src/modules/problems/core/problem.events';
import { VotesService } from '../src/modules/contributions/votes.service';
import {
  clearContributionQueue,
  createComment,
  createPost,
  writer,
} from './community-fixtures';
import { clearRateLimits } from './contest-fixtures';
import { setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('vote ledger', () => {
  let api: ApiTest;
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
    api = await setupApiTest();
    votes = api.app.get(VotesService);
    queue = api.app.get(getQueueToken(CONTRIBUTION_POINTS_QUEUE));
  });
  beforeEach(async () => {
    await clearRateLimits(api);
    await clearContributionQueue(api);
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await api.teardown();
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

  it('rejects a vote on a vanished target without leaving a row', async () => {
    const voter = await person();
    const vanished = newId();
    await expect(
      castOn(voter, vanished, (await person()).userId, 1),
    ).rejects.toMatchObject({ status: 404 });
    expect(await storedVotes(vanished)).toEqual([]);
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

  it('limits a voter to 60 votes a minute across posts and comments', async () => {
    const author = await person();
    const voter = await person();
    const comment = await createComment(api, {
      page: { type: 'blog', id: (await createPost(api))._id },
      author: author.userId,
    });
    const post = await createPost(api, { authors: [author.userId] });
    for (let index = 0; index < 30; index += 1) {
      await castOn(voter, comment._id, author.userId, index % 2 ? 1 : -1);
      await votes.cast(
        voter,
        { target: 'blog', targetId: post._id, ownerIds: [author.userId] },
        1,
      );
    }
    await expect(
      castOn(voter, comment._id, author.userId, 1),
    ).rejects.toMatchObject({ status: 429 });
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      (await queue.getJobs(['waiting'])).map((job) => job.data.userId).sort(),
    ).toEqual([author.userId, suggester.userId].sort());
  });
});
