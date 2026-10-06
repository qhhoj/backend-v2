import Redis from 'ioredis';
import {
  parseSubmissionEvent,
  SUBMISSION_EVENTS_CHANNEL,
} from './submission-events';
import type { SubmissionEvent } from './submission-events';

/** Subscribes like the api does and keeps every event, in order. */
export async function recordSubmissionEvents(redisUrl: string) {
  const subscriber = new Redis(redisUrl);
  const events: SubmissionEvent[] = [];
  subscriber.on('message', (_channel: string, raw: string) => {
    const event = parseSubmissionEvent(raw);
    if (event) events.push(event);
  });
  await subscriber.subscribe(SUBMISSION_EVENTS_CHANNEL);
  return {
    events,
    waitFor: async (
      predicate: (received: SubmissionEvent[]) => boolean,
      timeoutMs = 3000,
    ): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(events)) {
        if (Date.now() > deadline)
          throw new Error(`Events not received within ${timeoutMs} ms`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    stop: async (): Promise<void> => {
      await subscriber.quit();
    },
  };
}
