import { RunDeadlines } from './run-deadlines';

const TIMINGS = { runMarginMs: 600_000, runCaseBudget: 100 };
// Started with 400 cases at TL 2 s: 600 s + 400 × (3 × 2 + 1 + 5) s
const STARTED_MS = 600_000 + 400 * 12_000;

describe('RunDeadlines', () => {
  let deadlines: RunDeadlines;
  let expired: string[];
  const onExpiry = (key: string) => () => void expired.push(key);

  beforeEach(() => {
    jest.useFakeTimers();
    deadlines = new RunDeadlines(TIMINGS);
    expired = [];
  });
  afterEach(() => {
    deadlines.clearAll();
    jest.useRealTimers();
  });

  it('expires a run at margin + TL × budget after Assign', () => {
    deadlines.arm('r', 2, onExpiry('r'));
    jest.advanceTimersByTime(800_000 - 1);
    expect(expired).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(expired).toEqual(['r']);
  });

  it('restarts from Started with a per-case allowance', () => {
    deadlines.arm('r', 2, onExpiry('r'));
    jest.advanceTimersByTime(700_000);
    expect(deadlines.started('r', 400, onExpiry('r'))).toBe(true);
    jest.advanceTimersByTime(STARTED_MS - 1);
    expect(expired).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(expired).toEqual(['r']);
  });

  it('keeps the Started budget across a lost judge and its resume', () => {
    deadlines.arm('r', 2, onExpiry('r'));
    deadlines.started('r', 400, onExpiry('r'));
    deadlines.pause('r');
    jest.advanceTimersByTime(STARTED_MS * 2);
    expect(expired).toEqual([]);
    expect(deadlines.resume('r', onExpiry('r'))).toBe(true);
    jest.advanceTimersByTime(STARTED_MS - 1);
    expect(expired).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(expired).toEqual(['r']);
  });

  it('has no budget to resume or start for an unknown or cleared run', () => {
    deadlines.arm('r', 2, onExpiry('r'));
    deadlines.clear('r');
    expect(deadlines.resume('r', onExpiry('r'))).toBe(false);
    expect(deadlines.started('r', 10, onExpiry('r'))).toBe(false);
    jest.advanceTimersByTime(10 ** 9);
    expect(expired).toEqual([]);
  });

  it('does not fire at once when the case count overflows the timer range', () => {
    deadlines.arm('r', 10, onExpiry('r'));
    deadlines.started('r', 2 ** 32 - 1, onExpiry('r'));
    jest.advanceTimersByTime(24 * 24 * 3600_000);
    expect(expired).toEqual([]);
  });
});
