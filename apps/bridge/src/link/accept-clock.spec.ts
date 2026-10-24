import { DEFAULT_BRIDGE_TIMINGS } from '../bridge-timings';
import { TIMER_ACCEPT_CLOCK } from './accept-clock';

describe('TIMER_ACCEPT_CLOCK', () => {
  const ref = { submissionId: 's1', generation: 1 };
  const { acceptMs } = DEFAULT_BRIDGE_TIMINGS;
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('fires an armed window once its time has passed, and a cancelled one never', () => {
    const fired = jest.fn();
    TIMER_ACCEPT_CLOCK.arm(ref, acceptMs, fired);
    const cancelled = jest.fn();
    TIMER_ACCEPT_CLOCK.arm(ref, acceptMs, cancelled)();
    jest.advanceTimersByTime(acceptMs - 1);
    expect(fired).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(acceptMs);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
