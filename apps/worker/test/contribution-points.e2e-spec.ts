import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { REDIS } from '@libs/common';
import { waitUntil } from '@libs/common/testing';
import {
  childPath,
  CONTRIBUTION_POINTS_QUEUE,
  notifyContributionPoints,
} from '@libs/community';
import type { ContributionPointsJob } from '@libs/community';
import { newId } from '@libs/database';
import { profileQueries } from '@libs/database/testing';
import { ContributionPointsService } from '../src/jobs/contribution-points/contribution-points.service';
import { seedProblem, seedUser } from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('contribution points', () => {
  let worker: WorkerTest;
  let service: ContributionPointsService;
  const pointsOf = async (userId: string) =>
    (await worker.users.findById(userId, { contributionPoints: 1 }).lean())!
      .contributionPoints;
  const comment = (author: string, score: number, hidden = false) => {
    const commentId = newId();
    return worker.comments.create({
      _id: commentId,
      page: { type: 'blog', id: newId() },
      author,
      threadId: commentId,
      path: childPath(null, commentId),
      body: 'x',
      score,
      hidden,
    });
  };
  const post = (authors: string[], score: number, extra: object = {}) =>
    worker.blogPosts.create({
      title: 'P',
      slug: 'p',
      authors,
      publishOn: new Date(),
      content: 'x',
      visible: true,
      score,
      ...extra,
    });

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(ContributionPointsService);
  });
  afterAll(() => worker.teardown());

  it('sums visible comments, visible personal posts and public suggestions', async () => {
    const user = await seedUser(worker);
    const other = await seedUser(worker);
    await comment(user._id, 3);
    await comment(user._id, 10, true);
    await comment(other._id, 5);
    await post([user._id, other._id], 2);
    await post([user._id], 7, { organization: newId() });
    await post([user._id], 4, { visible: false });
    await seedProblem(worker, { suggester: user._id, isPublic: true });
    await seedProblem(worker, { suggester: user._id, isPublic: false });
    const operations = await profileQueries(worker.db, () =>
      service.recompute(user._id),
    );
    // 3 (comment) + 2 (post) + 20 (one public suggestion)
    expect(await pointsOf(user._id)).toBe(25);
    const reads = operations.filter(({ collection }) =>
      ['comments', 'blogPosts', 'problems'].includes(collection),
    );
    expect(reads.length).toBeGreaterThanOrEqual(3);
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
  });

  it('adds 10 points per good ticket and ignores ordinary ones', async () => {
    const user = await seedUser(worker);
    await worker.tickets.create({
      title: 'A',
      user: user._id,
      linkedItem: { type: 'general', id: newId() },
      isContributive: true,
    });
    await worker.tickets.create({
      title: 'B',
      user: user._id,
      linkedItem: { type: 'general', id: newId() },
      isContributive: true,
    });
    await worker.tickets.create({
      title: 'C',
      user: user._id,
      linkedItem: { type: 'general', id: newId() },
    });
    const operations = await profileQueries(worker.db, () =>
      service.recompute(user._id),
    );
    expect(await pointsOf(user._id)).toBe(20);
    await worker.tickets.updateOne(
      { user: user._id, title: 'A' },
      { isContributive: false },
    );
    await service.recompute(user._id);
    expect(await pointsOf(user._id)).toBe(10);
    const reads = operations.filter(
      ({ collection }) => collection === 'tickets',
    );
    expect(reads.length).toBeGreaterThanOrEqual(1);
    expect(
      reads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
  });

  it('recomputes through the queue', async () => {
    const user = await seedUser(worker, { contributionPoints: 99 });
    await comment(user._id, -2);
    const queue = worker.module.get<Queue<ContributionPointsJob>>(
      getQueueToken(CONTRIBUTION_POINTS_QUEUE),
    );
    await notifyContributionPoints(
      queue,
      worker.module.get<Redis>(REDIS),
      [user._id],
      new Logger('test'),
    );
    await waitUntil(async () => (await pointsOf(user._id)) === -2);
  });
});
