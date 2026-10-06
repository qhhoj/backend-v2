import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import { BRIDGE_COMMANDS_STREAM, parseBridgeCommand } from './bridge-commands';
import { BridgeCommandsService } from './bridge-commands.service';

describe('BridgeCommandsService', () => {
  const redis = new Redis(TEST_REDIS_URL);
  const commands = new BridgeCommandsService(redis);
  const published = async () =>
    (await redis.xrange(BRIDGE_COMMANDS_STREAM, '-', '+')).map(([, fields]) =>
      parseBridgeCommand(fields[fields.indexOf('command') + 1]),
    );
  beforeEach(() => redis.del(BRIDGE_COMMANDS_STREAM));
  afterAll(() => redis.quit());

  it('publishes commands the bridge can parse, in order', async () => {
    const submissionId = newId();
    await commands.publish({ type: 'abort', submissionId });
    await commands.judge([submissionId], 'judge-01');
    expect(await published()).toEqual([
      { type: 'abort', submissionId },
      {
        type: 'judge',
        submissionIds: [submissionId],
        judgeName: 'judge-01',
        bannedJudges: [],
      },
    ]);
  });
  it('splits a large rejudge into commands of at most 1000 ids, losing none', async () => {
    const ids = Array.from({ length: 2500 }, newId);
    await commands.judge(ids);
    const sent = await published();
    expect(
      sent.map(
        (command) => command?.type === 'judge' && command.submissionIds.length,
      ),
    ).toEqual([1000, 1000, 500]);
    expect(
      sent.flatMap((command) =>
        command?.type === 'judge' ? command.submissionIds : [],
      ),
    ).toEqual(ids);
  });
  it('never fails the caller when Redis is unreachable', async () => {
    const offline = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
    });
    await expect(
      new BridgeCommandsService(offline).publish({
        type: 'abort',
        submissionId: newId(),
      }),
    ).resolves.toBeUndefined();
    offline.disconnect();
  });
});
