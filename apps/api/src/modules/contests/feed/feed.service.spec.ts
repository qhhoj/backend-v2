import { AppError } from '@libs/common';
import type { FeedContext } from './feed-auth.service';
import type { FeedDataRepository } from './feed-data.repository';
import { FeedService, newFeedSession } from './feed.service';

describe('FeedService size check', () => {
  const context = {
    contest: { _id: 'c1', problems: [] },
  } as unknown as FeedContext;
  const limits = { maxSubmissions: 100, maxStreamSubmissions: 2 };
  const NOW = new Date('2026-01-01T12:00:00Z');
  let data: {
    teams: jest.Mock;
    countContestSubmissions: jest.Mock;
    allSubmissions: jest.Mock;
    changedSubmissions: jest.Mock;
  };
  let feeds: FeedService;

  beforeEach(() => {
    data = {
      teams: jest.fn().mockResolvedValue([]),
      countContestSubmissions: jest.fn().mockResolvedValue(3),
      allSubmissions: jest.fn().mockResolvedValue([]),
      changedSubmissions: jest.fn().mockResolvedValue([]),
    };
    feeds = new FeedService(data as unknown as FeedDataRepository, limits);
  });

  it('refuses a stream whose contest outgrew the cap before the periodic full reload reads any row', async () => {
    const session = newFeedSession();
    session.since = new Date(NOW.getTime() - 1_000);
    session.loadedAt = NOW.getTime() - 11 * 60_000;
    const error: unknown = await feeds
      .eventsFor(context, NOW, session)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('feed_too_large_for_stream');
    expect(data.allSubmissions).not.toHaveBeenCalled();
  });

  it('does not count on an ordinary incremental tick', async () => {
    data.countContestSubmissions.mockResolvedValue(0);
    const session = newFeedSession();
    session.since = new Date(NOW.getTime() - 1_000);
    session.loadedAt = NOW.getTime() - 1_000;
    await feeds.eventsFor(context, NOW, session).catch(() => undefined);
    expect(data.countContestSubmissions).not.toHaveBeenCalled();
    expect(data.changedSubmissions).toHaveBeenCalled();
  });
});
