import { DEFAULT_STREAM_LIMITS } from './stream-limits';

describe('DEFAULT_STREAM_LIMITS', () => {
  it('reserves slots for submission and ticket streams however full the capped channels are', () => {
    const { userTotal, total, feedTotal, contestTotal, contestFeedTotal } =
      DEFAULT_STREAM_LIMITS;
    const reserved =
      total - (userTotal + feedTotal + contestTotal + contestFeedTotal);
    expect(reserved).toBeGreaterThanOrEqual(500);
  });
});
