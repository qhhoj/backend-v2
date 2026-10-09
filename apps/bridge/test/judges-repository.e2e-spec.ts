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
});
