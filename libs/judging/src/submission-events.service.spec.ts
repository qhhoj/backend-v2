import { Logger } from '@nestjs/common';
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
  afterEach(() => jest.restoreAllMocks());
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
      const service = new SubmissionEventsService(redis);
      await service.onModuleInit(); // as Nest does: wait for the connection, else the ready guard skips the publish
      await service.publish(event);
      await recorder.waitFor((events) => events.length === 1);
      expect(recorder.events).toEqual([event]);
    } finally {
      await recorder.stop();
    }
  });

  const eventOf = () =>
    submissionEvent(
      { submissionId: newId(), userId: newId(), problemId: newId() },
      'done',
      'D',
    );

  it('skips at once and never fails the caller while Redis is unreachable', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const unreachable = new Redis('redis://10.255.255.1:6379', {
      maxRetriesPerRequest: 3,
      connectTimeout: 500,
    });
    unreachable.on('error', () => undefined);
    const started = Date.now();
    await expect(
      new SubmissionEventsService(unreachable).publish(eventOf()),
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(100);
    unreachable.disconnect();
  });

  it('gives up within its bound and logs when a connected Redis never answers', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const hanging = {
      status: 'ready',
      publish: () => new Promise(() => undefined),
    } as unknown as Redis;
    const started = Date.now();
    await expect(
      new SubmissionEventsService(hanging).publish(eventOf()),
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(EVENT_PUBLISH_TIMEOUT_MS + 500);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('waits for the connection at boot, so a boot-time event is published and not skipped', async () => {
    const recorder = await recordSubmissionEvents(TEST_REDIS_URL);
    const booting = new Redis(TEST_REDIS_URL, { lazyConnect: true });
    try {
      const service = new SubmissionEventsService(booting);
      const event = eventOf();
      await service.onModuleInit();
      await service.publish(event);
      await recorder.waitFor((events) => events.length === 1);
      expect(recorder.events).toEqual([event]);
    } finally {
      await recorder.stop();
      await booting.quit();
    }
  });
});
