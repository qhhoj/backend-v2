import { DEFAULT_STREAM_LIMITS } from './stream-limits';

describe('DEFAULT_STREAM_LIMITS', () => {
  it('leaves room for other stream kinds beside notification streams', () => {
    const { userTotal, total, feedTotal, contestTotal } = DEFAULT_STREAM_LIMITS;
    expect(total - userTotal).toBeGreaterThanOrEqual(feedTotal);
    expect(total - userTotal).toBeGreaterThan(0);
    expect(contestTotal).toBeLessThan(total);
  });
});
