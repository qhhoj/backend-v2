import { JUDGE_IP_HISTORY_LIMIT } from '@libs/database';
import { JudgesRepository } from '../src/judges/judges.repository';
import type { SessionDetails } from '../src/judges/judges.repository';
import { seedJudge } from './fixtures';
import { setupBridgeTest } from './setup';
import type { BridgeTest } from './setup';

const details = (build: string): SessionDetails => ({
  slots: 2,
  build,
  protocolMinor: 1,
  features: [],
  runtimes: [],
  lastIp: null,
});

describe('JudgesRepository (judge sessions)', () => {
  let bridge: BridgeTest;
  let judges: JudgesRepository;
  const row = async (name: string) =>
    (await bridge.judges.findOne({ name }).lean())!;

  beforeAll(async () => {
    bridge = await setupBridgeTest();
    judges = bridge.module.get(JudgesRepository);
  });
  afterAll(() => bridge.teardown());

  it('keeps the newer session on the row when an older session marks it online late', async () => {
    await seedJudge(bridge, 'late-hello', 'late-hello-key');
    const [older, newer] = [new Date(1_000), new Date(2_000)];
    await judges.markSessionOnline('late-hello', newer, details('newer'));
    await judges.markSessionOnline('late-hello', older, details('older'));
    expect(await row('late-hello')).toMatchObject({
      online: true,
      startTime: newer,
      build: 'newer',
    });
    await judges.recordPong('late-hello', newer, {
      ping: 0.5,
      load: 0.1,
      busy: 1,
    });
    await judges.markOffline('late-hello', older);
    expect(await row('late-hello')).toMatchObject({
      online: true,
      ping: 0.5,
      busy: 1,
    });
    await judges.markOffline('late-hello', newer);
    expect(await row('late-hello')).toMatchObject({ online: false, busy: 0 });
  });

  it('keeps one entry per address and drops the least recently seen past the limit', async () => {
    await seedJudge(bridge, 'roaming', 'roaming-key');
    const at = (second: number) => new Date(second * 1_000);
    await judges.recordAddress('roaming', '10.0.0.1', at(1));
    for (let index = 0; index < JUDGE_IP_HISTORY_LIMIT; index++)
      await judges.recordAddress('roaming', `10.0.1.${index}`, at(10 + index));
    // 10.0.0.1 was dropped as the least recently seen; seen again it starts afresh
    await judges.recordAddress('roaming', '10.0.1.0', at(100));
    await judges.recordAddress('roaming', '10.0.1.0', at(101));
    await judges.recordAddress('roaming', '10.0.0.1', at(102));
    const { ipHistory } = await row('roaming');
    expect(ipHistory).toHaveLength(JUDGE_IP_HISTORY_LIMIT);
    expect(ipHistory.find(({ ip }) => ip === '10.0.1.0')).toMatchObject({
      firstSeen: at(10),
      lastSeen: at(101),
      connections: 3,
    });
    expect(ipHistory.find(({ ip }) => ip === '10.0.0.1')).toMatchObject({
      firstSeen: at(102),
      connections: 1,
    });
    // the next-oldest by last sighting (10.0.1.1) made room for 10.0.0.1
    expect(ipHistory.map(({ ip }) => ip)).not.toContain('10.0.1.1');
  });
});
