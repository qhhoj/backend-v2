import Redis from 'ioredis';
import { TEST_REDIS_URL, waitUntil } from '@libs/common/testing';
import { Status } from '@libs/judge-proto';
import { BridgeCommandsService } from '@libs/judging';
import { FakeJudge } from './fake-judge';
import {
  seedCatalog,
  seedJudge,
  seedProblem,
  seedSubmission,
} from './fixtures';
import type { BridgeCatalog } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

/** The bridge reader is deliberately unfiltered (reader table row 10): a submission queued before a delete is still judged. This spec fails if someone adds `deletedAt: null` there. */
describe('a submission queued before its problem was deleted', () => {
  let bridge: BridgeTest;
  let catalog: BridgeCatalog;
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    catalog = await seedCatalog(bridge);
    await seedJudge(bridge, 'bd-judge', 'bd-key');
  });
  afterAll(async () => {
    await redis.quit();
    await bridge.teardown();
  });

  it.each([
    ['soft-deleted', {}],
    ['tombstoned', { purgedAt: new Date(), description: '' }],
  ])(
    'is still assigned and graded when the problem is %s',
    async (state, purged) => {
      const problem = await seedProblem(bridge, catalog, {
        code: `bd_${state.replace('-', '')}`,
      });
      const submission = await seedSubmission(bridge, catalog, {
        problem: problem._id,
      });
      await bridge.problems.updateOne(
        { _id: problem._id },
        { $set: { deletedAt: new Date(), ...purged } },
      );
      const fake = await FakeJudge.online(bridge.judgePort(), {
        name: 'bd-judge',
        key: 'bd-key',
      });
      await commands.judge([submission._id]);
      const assign = await fake.nextAssign();
      expect(assign).toMatchObject({
        problemCode: problem.code,
        ref: { submissionId: submission._id },
      });
      await fake.grade(assign.ref!, [
        { position: 1, status: Status.STATUS_AC, points: 1, total: 1 },
      ]);
      await waitUntil(async () =>
        (await bridge.gradedJobs()).some(
          (job) => job.submissionId === submission._id,
        ),
      );
      expect(
        await bridge.submissions.findById(submission._id).lean(),
      ).toMatchObject({ status: 'D', result: 'AC' });
      await fake.close();
    },
  );
});
