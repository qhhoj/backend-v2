import Redis from 'ioredis';
import { TEST_REDIS_URL } from '@libs/common/testing';
import { newId } from '@libs/database';
import { submissionEvent } from './submission-events';
import {
  EVENT_PUBLISH_TIMEOUT_MS,
  SubmissionEventsService,
} from './submission-events.service';
import { recordSubmissionEvents } from './testing';

describe('SubmissionEventsService', () => {
  const redis = new Redis(TEST_REDIS_URL);
  afterAll(() => redis.quit());

  it('publishes events subscribers can parse', async () => {
    const recorder = await recordSubmissionEvents(TEST_REDIS_URL);
    try {
      const event = submissionEvent(
        { submissionId: newId(), userId: newId(), problemId: newId() },
        'processing',
        'P',
      );
      await new SubmissionEventsService(redis).publish(event);
      await recorder.waitFor((events) => events.length === 1);
      expect(recorder.events).toEqual([event]);
    } finally {
      await recorder.stop();
    }
  });

  it('gives up within its bound and never fails the caller when Redis is unreachable', async () => {
    const unreachable = new Redis('redis://10.255.255.1:6379', {
      maxRetriesPerRequest: 3,
      connectTimeout: 500,
    });
    unreachable.on('error', () => undefined);
    const started = Date.now();
    await expect(
      new SubmissionEventsService(unreachable).publish(
        submissionEvent(
          { submissionId: newId(), userId: newId(), problemId: newId() },
          'done',
          'D',
        ),
      ),
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(EVENT_PUBLISH_TIMEOUT_MS + 1000);
    unreachable.disconnect();
  });
});
