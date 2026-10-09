import { createHash } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { FeedEvent } from '@libs/contests';
import type { FeedContext } from './feed-auth.service';
import { FeedService, newFeedSession } from './feed.service';

/** A built event with what a stream needs to diff it: its identity and a hash of its content. */
export interface DigestedEvent {
  event: FeedEvent;
  slot: string;
  digest: string;
}

/** The slot is the event's identity (a re-judged submission replaces its old content); the digest changes when the content does. */
export const digestedOf = (event: FeedEvent): DigestedEvent => ({
  event,
  slot: `${event.type}:${event.id ?? ''}`,
  digest: createHash('sha1')
    .update(JSON.stringify(event.data))
    .digest('base64'),
});

/** One open stream. */
export interface FeedSubscriber {
  response: ServerResponse;
  context: FeedContext;
  /** Slot to digest of what this stream has been sent. */
  sent: Map<string, string>;
  nextToken: number;
  keepAlive?: NodeJS.Timeout;
}

interface Build {
  at: number;
  events: Promise<DigestedEvent[]>;
}

/** Everything the streams of one contest share: the submissions read so far and the feed built for the current tick. */
export class FeedRoom {
  readonly subscribers = new Set<FeedSubscriber>();
  /** Streams being opened plus streams open; the room goes away at zero. */
  holders = 0;
  timer?: NodeJS.Timeout;
  isTicking = false;
  private readonly session = newFeedSession();
  private readonly builds = new Map<string, Build>();

  constructor(
    private readonly feeds: FeedService,
    /** A build younger than this is reused, so N streams on a contest cost one build per tick. */
    private readonly reuseMs: number,
  ) {}

  /** The feed as the key sees it, built once per key state and tick. */
  build(context: FeedContext, now = new Date()): Promise<DigestedEvent[]> {
    const { feedKey } = context;
    const variant = `${feedKey.id}|${feedKey.mode}|${feedKey.releasedAt?.getTime() ?? ''}`;
    for (const [name, build] of this.builds)
      if (now.getTime() - build.at >= this.reuseMs) this.builds.delete(name);
    const known = this.builds.get(variant);
    if (known) return known.events;
    const events = this.feeds
      .eventsFor(context, now, this.session)
      .then((built) => built.map(digestedOf));
    this.builds.set(variant, { at: now.getTime(), events });
    events.catch(() => this.builds.delete(variant));
    return events;
  }
}

/** What a stream has not been sent yet, numbered on from its last token. */
export const unsentOf = (
  subscriber: FeedSubscriber,
  built: readonly DigestedEvent[],
): FeedEvent[] => {
  const fresh: FeedEvent[] = [];
  for (const { event, slot, digest } of built) {
    if (subscriber.sent.get(slot) === digest) continue;
    subscriber.sent.set(slot, digest);
    fresh.push({ ...event, token: String(subscriber.nextToken++) });
  }
  return fresh;
};
