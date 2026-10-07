import { Queue } from 'bullmq';
import { waitUntil } from '@libs/common/testing';
import { ORGANIZATION_POINTS_JOB } from '@libs/community';
import { profileQueries } from '@libs/database/testing';
import { OrganizationPointsRepository } from '../src/jobs/organization-points/organization-points.repository';
import { OrganizationPointsService } from '../src/jobs/organization-points/organization-points.service';
import { SubmissionEffectsService } from '../src/jobs/submission-effects/submission-effects.service';
import {
  seedGraded,
  seedOrganization,
  seedProblem,
  seedUser,
} from './effects-fixtures';
import { setupWorkerTest } from './setup';
import type { WorkerTest } from './setup';

describe('organization points', () => {
  let worker: WorkerTest;
  let service: OrganizationPointsService;
  let effects: SubmissionEffectsService;
  const stored = async (organizationId: string) =>
    (await worker.organizations
      .findById(organizationId, { performancePoints: 1, memberCount: 1 })
      .lean())!;

  beforeAll(async () => {
    worker = await setupWorkerTest();
    service = worker.module.get(OrganizationPointsService);
    effects = worker.module.get(SubmissionEffectsService);
  });
  afterAll(() => worker.teardown());

  it('sums 0.95^i × pp over members with pp > 0 and counts every member', async () => {
    const organization = await seedOrganization(worker);
    await seedUser(worker, {
      organizations: [organization._id],
      performancePoints: 50,
    });
    await seedUser(worker, {
      organizations: [organization._id],
      performancePoints: 100,
    });
    await seedUser(worker, {
      organizations: [organization._id],
      performancePoints: 0,
    });
    await seedUser(worker, {
      organizations: [organization._id],
      performancePoints: 10,
      isUnlisted: true,
    });
    await seedUser(worker, { performancePoints: 1000 });
    await service.recompute(organization._id);
    const { performancePoints, memberCount } = await stored(organization._id);
    expect(performancePoints).toBeCloseTo(100 + 0.95 * 50 + 0.95 ** 2 * 10, 9);
    expect(memberCount).toBe(4);
  });

  it('weighs only the top 100 members and reads them through the members index', async () => {
    const organization = await seedOrganization(worker);
    await worker.users.insertMany(
      Array.from({ length: 150 }, (_unused, index) => ({
        username: `org_pp_${index}`,
        password: '!',
        isActive: true,
        organizations: [organization._id],
        performancePoints: 1,
      })),
    );
    const operations = await profileQueries(worker.db, () =>
      service.recompute(organization._id),
    );
    expect((await stored(organization._id)).performancePoints).toBeCloseTo(
      (1 - 0.95 ** 100) / 0.05,
      9,
    );
    expect((await stored(organization._id)).memberCount).toBe(150);
    const userReads = operations.filter(
      ({ collection }) => collection === 'users',
    );
    expect(userReads.length).toBeGreaterThan(0);
    expect(
      userReads.every(({ planSummary }) => !planSummary.includes('COLLSCAN')),
    ).toBe(true);
  });

  it('reads exactly the top 100 member PPs, best first', async () => {
    const organization = await seedOrganization(worker);
    // Inserted lowest first, so the best members are the last stored.
    await worker.users.insertMany(
      Array.from({ length: 150 }, (_unused, index) => ({
        username: `org_top_${index}`,
        password: '!',
        isActive: true,
        organizations: [organization._id],
        performancePoints: index + 1,
      })),
    );
    const top = await worker.module
      .get(OrganizationPointsRepository)
      .topMemberPoints(organization._id, 100);
    expect(top).toEqual(
      Array.from({ length: 100 }, (_unused, rank) => 150 - rank),
    );
  });

  it('queues the member organizations when a graded submission changes the PP, and nothing when it does not', async () => {
    const [first, second] = [
      await seedOrganization(worker),
      await seedOrganization(worker),
    ];
    const member = await seedUser(worker, {
      organizations: [first._id, second._id],
    });
    const problem = await seedProblem(worker);
    const submission = await seedGraded(worker, member._id, problem._id);
    const job = {
      submissionId: submission._id,
      userId: member._id,
      problemId: problem._id,
    };
    // The queue is registered in two modules, so spy on the prototype and keep only this job's calls.
    const added = jest.spyOn(Queue.prototype, 'addBulk');
    const queuedOrganizations = () =>
      added.mock.calls
        .flatMap(([jobs]) => jobs)
        .filter(({ name }) => name === ORGANIZATION_POINTS_JOB)
        .map(({ data }) => (data as { organizationId: string }).organizationId);
    try {
      await effects.apply(job);
      expect(queuedOrganizations().sort()).toEqual(
        [first._id, second._id].sort(),
      );
      await waitUntil(
        async () => (await stored(first._id)).performancePoints > 0,
      );
      expect((await stored(first._id)).performancePoints).toBeCloseTo(
        1000 + 0.05,
        9,
      );
      await waitUntil(async () => (await stored(second._id)).memberCount === 1);
      added.mockClear();
      await effects.apply(job);
      expect(queuedOrganizations()).toEqual([]);
    } finally {
      added.mockRestore();
    }
  });

  it('leaves a deleted organization alone', async () => {
    const organization = await seedOrganization(worker);
    await worker.organizations.deleteOne({ _id: organization._id });
    await expect(service.recompute(organization._id)).resolves.toBeUndefined();
    expect(
      await worker.organizations.countDocuments({ _id: organization._id }),
    ).toBe(0);
  });
});
