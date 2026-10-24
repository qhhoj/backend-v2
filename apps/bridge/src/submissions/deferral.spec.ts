import { DEFAULT_BRIDGE_TIMINGS } from '../bridge-timings';
import { nextDeferral } from './deferral';

describe('nextDeferral', () => {
  afterEach(() => jest.restoreAllMocks());

  it('spreads the backoff up to 20% either way, so rows deferred together do not come due together', () => {
    const now = new Date('2026-10-24T10:00:00Z');
    const retryAfterMs = (random: number) => {
      jest.spyOn(Math, 'random').mockReturnValue(random);
      const deferral = nextDeferral(
        null,
        'sandbox',
        now,
        DEFAULT_BRIDGE_TIMINGS,
      );
      return deferral!.retryAfter.getTime() - now.getTime();
    };
    const backoffMs = DEFAULT_BRIDGE_TIMINGS.deferralBackoffMs;
    expect(retryAfterMs(0)).toBe(backoffMs * 0.8);
    expect(retryAfterMs(0.5)).toBe(backoffMs);
    expect(retryAfterMs(0.999)).toBeLessThanOrEqual(backoffMs * 1.2);
    expect(retryAfterMs(0.999)).toBeGreaterThan(backoffMs * 1.19);
  });
});
