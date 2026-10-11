import { Logger } from '@nestjs/common';
import { BridgeService } from './bridge.service';

const RESYNC_MS = 300;

/** Collaborators that record every call in order; `loadQueued` and `inFlightRuns` are what a test varies. */
function setup() {
  const calls: string[] = [];
  const record =
    <Result>(name: string, result: Result) =>
    () => {
      calls.push(name);
      return Promise.resolve(result);
    };
  const loadQueued = jest.fn(record('loadQueued', []));
  const inFlightRuns = jest.fn(
    record(
      'inFlightRuns',
      [] as Array<{ id: string; judgedOn: string; generation: number }>,
    ),
  );
  const resetStrandedRuns = jest.fn(record('resetStrandedRuns', []));
  const unpinAbsent = jest.fn(record('unpinAbsent', [] as string[]));
  const heldIds = jest.fn((): string[] => []);
  const services = {
    judges: { setAllOffline: record('setAllOffline', undefined) },
    submissions: { loadQueued, inFlightRuns, resetStrandedRuns, unpinAbsent },
    runs: { announceRequeued: jest.fn() },
    dispatch: {
      enqueue: record('enqueue', undefined),
      clearRetryBans: record('clearRetryBans', undefined),
      hasQueued: () => false,
      heldIds,
      connectedNames: () => [] as string[],
      stop: () => calls.push('dispatch.stop'),
    },
    commands: {
      position: record('position', '0-0'),
      start: () => calls.push('commands.start'),
      stop: record('commands.stop', undefined),
    },
    external: {
      start: () => calls.push('external.start'),
      stop: record('external.stop', undefined),
    },
    server: {
      listen: record('listen', 9999),
      acceptJudges: () => calls.push('acceptJudges'),
      close: record('server.close', undefined),
    },
  };
  const bridge = new BridgeService(
    { resyncMs: RESYNC_MS, pinFallbackMs: 300_000 } as never,
    services.dispatch as never,
    services.commands as never,
    services.server as never,
    services.judges as never,
    services.submissions as never,
    services.runs as never,
    services.external as never,
  );
  return { bridge, calls, services, unpinAbsent };
}

describe('BridgeService', () => {
  it('re-enqueues rows whose pinned judge stayed away, so the dropped pin takes effect', async () => {
    jest.useFakeTimers();
    const { bridge, services, unpinAbsent } = setup();
    unpinAbsent.mockResolvedValueOnce(['pinned-1']);
    await bridge.onApplicationBootstrap();
    services.submissions.loadQueued.mockClear();
    await jest.advanceTimersByTimeAsync(RESYNC_MS);
    expect(unpinAbsent).toHaveBeenCalledWith([], expect.any(Date));
    expect(services.submissions.loadQueued).toHaveBeenCalledWith(['pinned-1']);
    await bridge.onModuleDestroy();
    jest.useRealTimers();
  });

  let logged: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const tick = (times = 1) => jest.advanceTimersByTimeAsync(RESYNC_MS * times);

  it('binds the port first, marks judges offline, leaves P/G rows to resume, reads the stream position before the rebuild, and serves judges last', async () => {
    const { bridge, calls } = setup();
    await bridge.onApplicationBootstrap();
    expect(calls).toEqual([
      'listen',
      'setAllOffline',
      'position',
      'loadQueued',
      'enqueue',
      'commands.start',
      'external.start',
      'acceptJudges',
    ]);
    await bridge.onModuleDestroy();
  });

  it('stops dispatching before it drops the judges, and resyncs no more once stopped', async () => {
    const { bridge, calls, services } = setup();
    await bridge.onApplicationBootstrap();
    calls.length = 0;
    await bridge.onModuleDestroy();
    expect(calls).toEqual([
      'external.stop',
      'dispatch.stop',
      'commands.stop',
      'server.close',
      'setAllOffline',
    ]);
    services.submissions.loadQueued.mockClear();
    await tick(5);
    expect(services.submissions.loadQueued).not.toHaveBeenCalled();
  });

  it('resyncs on every tick, and skips a tick while the previous one still runs', async () => {
    const { bridge, services } = setup();
    await bridge.onApplicationBootstrap();
    services.submissions.loadQueued.mockClear();
    services.submissions.loadQueued.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([]), RESYNC_MS * 2.5),
        ),
    );
    await tick(10);
    // 10 ticks, each load takes 2.5 ticks: a tick that overlaps is skipped
    expect(
      services.submissions.loadQueued.mock.calls.length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      services.submissions.loadQueued.mock.calls.length,
    ).toBeLessThanOrEqual(4);
    await bridge.onModuleDestroy();
  });

  it('keeps ticking after a failed resync and logs it', async () => {
    const { bridge, services } = setup();
    await bridge.onApplicationBootstrap();
    services.submissions.loadQueued
      .mockClear()
      .mockRejectedValueOnce(new Error('mongo down'));
    await tick(3);
    expect(services.submissions.loadQueued).toHaveBeenCalledTimes(3);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('mongo down'));
    await bridge.onModuleDestroy();
  });

  describe('P/G rows no judge holds', () => {
    const ghost = { id: 'ghost', judgedOn: 'gone', generation: 1 };
    const held = { id: 'held', judgedOn: 'busy', generation: 2 };

    it('are requeued only after two consecutive ticks without a holder', async () => {
      const { bridge, services } = setup();
      services.submissions.inFlightRuns.mockResolvedValue([ghost, held]);
      services.dispatch.heldIds.mockReturnValue(['held']);
      await bridge.onApplicationBootstrap();
      await tick();
      expect(services.submissions.resetStrandedRuns).not.toHaveBeenCalled();
      await tick();
      expect(services.submissions.resetStrandedRuns).toHaveBeenCalledWith([
        ghost,
      ]);
      await bridge.onModuleDestroy();
    });

    it('are left alone when a judge holds them on the second tick', async () => {
      const { bridge, services } = setup();
      services.submissions.inFlightRuns.mockResolvedValue([ghost]);
      await bridge.onApplicationBootstrap();
      await tick();
      services.dispatch.heldIds.mockReturnValue(['ghost']);
      await tick(3);
      expect(services.submissions.resetStrandedRuns).not.toHaveBeenCalled();
      await bridge.onModuleDestroy();
    });
  });
});
