import { FakeJudge } from '../../test/fake-judge';
import { JudgeServerService } from './judge-server.service';

const TIMINGS = {
  handshakeMs: 5000,
  idleMs: 60_000,
  ackMs: 60_000,
  pingIntervalMs: 60_000,
  resyncMs: 60_000,
  acceptMs: 20_000,
  resumeGraceMs: 30_000,
};

describe('JudgeServerService start-up', () => {
  const server = new JudgeServerService(
    { judgeBridgePort: 0, judgeBridgeHost: '127.0.0.1' } as never,
    TIMINGS,
    {
      authenticate: () =>
        Promise.resolve({ isDisabled: false, authKeyHash: 'hash' }),
      markOnline: () => Promise.resolve(),
      markOffline: () => Promise.resolve(),
      updatePing: () => Promise.resolve(),
    } as never,
    {
      register: () => Promise.resolve(),
      judgeLost: () => Promise.resolve(),
      isStopped: () => false,
    } as never,
    {} as never,
  );
  afterAll(() => server.close());

  it('holds a judge that connects before start-up is done, then serves it', async () => {
    const port = await server.listen();
    const judge = await FakeJudge.connect(port);
    judge.send({
      name: 'handshake',
      id: 'early',
      key: 'k',
      problems: [],
      executors: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(judge.received).toEqual([]);
    expect(judge.isClosed).toBe(false);
    server.acceptJudges();
    await judge.next('handshake-success');
    await judge.close();
  });
});
