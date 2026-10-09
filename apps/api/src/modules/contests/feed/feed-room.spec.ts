import type { FeedContext } from './feed-auth.service';
import { FeedRoom } from './feed-room';
import type { FeedService } from './feed.service';

const NOW = new Date('2026-01-01T12:00:00Z');

const contextOf = (frozenLastMinutes: number, endTime: Date): FeedContext =>
  ({
    contest: { _id: 'c1', frozenLastMinutes, endTime },
    feedKey: { id: 'k1', mode: 'frozen-until-release', releasedAt: null },
  }) as unknown as FeedContext;

describe('FeedRoom.build', () => {
  const end = new Date('2026-01-01T15:00:00Z');
  let eventsFor: jest.Mock;
  let room: FeedRoom;

  beforeEach(() => {
    eventsFor = jest.fn().mockResolvedValue([]);
    room = new FeedRoom({ eventsFor } as unknown as FeedService, 5_000);
  });

  it('serves streams of one key state from one build within the reuse window', async () => {
    await room.build(contextOf(60, end), NOW);
    await room.build(contextOf(60, end), new Date(NOW.getTime() + 1_000));
    expect(eventsFor).toHaveBeenCalledTimes(1);
  });

  it('builds again at once when an editor changes the freeze minutes', async () => {
    await room.build(contextOf(60, end), NOW);
    await room.build(contextOf(0, end), new Date(NOW.getTime() + 1_000));
    expect(eventsFor).toHaveBeenCalledTimes(2);
  });

  it('builds again at once when an editor moves the end time', async () => {
    await room.build(contextOf(60, end), NOW);
    await room.build(
      contextOf(60, new Date(end.getTime() + 60_000)),
      new Date(NOW.getTime() + 1_000),
    );
    expect(eventsFor).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed build, so the next call retries', async () => {
    eventsFor.mockRejectedValueOnce(new Error('db down'));
    await expect(room.build(contextOf(60, end), NOW)).rejects.toThrow(
      'db down',
    );
    await expect(room.build(contextOf(60, end), NOW)).resolves.toEqual([]);
    expect(eventsFor).toHaveBeenCalledTimes(2);
  });
});
