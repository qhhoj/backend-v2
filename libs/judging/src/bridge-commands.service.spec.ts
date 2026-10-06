import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import {
  BRIDGE_COMMANDS_MAX_LENGTH,
  BRIDGE_COMMANDS_STREAM,
  parseBridgeCommand,
} from './bridge-commands';
import {
  BridgeCommandsService,
  PUBLISH_TIMEOUT_MS,
} from './bridge-commands.service';

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
  it('publishes nothing for an empty rejudge', async () => {
    await commands.judge([]);
    expect(await published()).toEqual([]);
  });
  it('trims the stream to about its cap', async () => {
    const submissionId = newId();
    for (let sent = 0; sent < BRIDGE_COMMANDS_MAX_LENGTH + 1500; sent += 1)
      await commands.publish({ type: 'abort', submissionId });
    expect(await redis.xlen(BRIDGE_COMMANDS_STREAM)).toBeLessThan(
      BRIDGE_COMMANDS_MAX_LENGTH + 1000,
    );
  });
  it('gives up within a short fixed delay when Redis does not answer, with the normal client config', async () => {
    const unreachable = new Redis('redis://10.255.255.1:6379', {
      maxRetriesPerRequest: 3,
      connectTimeout: 500,
    });
    unreachable.on('error', () => undefined);
    const started = Date.now();
    await new BridgeCommandsService(unreachable).publish({
      type: 'abort',
      submissionId: newId(),
    });
    expect(Date.now() - started).toBeLessThan(PUBLISH_TIMEOUT_MS + 1000);
    unreachable.disconnect();
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
