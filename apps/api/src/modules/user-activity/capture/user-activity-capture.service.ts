import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { execOrThrow, REDIS } from '@libs/common';
import {
  ACCESS_WRITE_SECONDS,
  ACTIVITY_TEXT_MAX,
  activitySessionKey,
  isTrackedPath,
  redactCredentials,
  stripQuery,
} from '@libs/community';
import { withinTimeout } from '@libs/judging';
import { ActiveUsersStore } from './active-users.store';
import { ActivityBuffer } from './activity-buffer';
import { ActivityWriterRepository } from './activity-writer.repository';
import type { ActivityRow } from './activity-row';

/** Error name and code only: driver messages can echo stored values. */
const describe = (error: unknown): string => {
  const { name, code } = (error ?? {}) as {
    name?: string;
    code?: string | number;
  };
  return `${name ?? 'Error'}${code === undefined ? '' : ` (${code})`}`;
};

/** A hung database must not stall the single in-flight flush forever. */
const FLUSH_TIMEOUT_MS = 10_000;

/** Legacy `BatchUserActivityMiddleware` as a Fastify `onResponse` hook: runs after the response is sent and only pushes into the buffer (no awaits), so it cannot change or slow an answer. Registered from a module (not `configureApp`) because only the api records activity. */
@Injectable()
export class UserActivityCaptureService implements OnModuleInit {
  private readonly logger = new Logger(UserActivityCaptureService.name);
  private readonly buffer = new ActivityBuffer<ActivityRow>(
    // The timeout stops waiting, it does not cancel the write: a hung write may still land and overlap the next flush.
    (rows) => withinTimeout(this.persist(rows), FLUSH_TIMEOUT_MS),
    (error, dropped) =>
      this.logger.error(`Dropped ${dropped} activity rows: ${describe(error)}`),
  );

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly writer: ActivityWriterRepository,
    private readonly active: ActiveUsersStore,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Fastify takes hooks until the server is ready, and `onModuleInit` runs before that. The last flush is an `onClose` hook, which Fastify runs after in-flight requests finished, so their rows are not lost (Nest's `onModuleDestroy` runs before the server drains). */
  onModuleInit(): void {
    const server = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
    server.addHook('onResponse', (request, reply, done) => {
      this.collect(request, reply);
      done();
    });
    server.addHook('onClose', () => this.buffer.stop());
    this.buffer.start();
  }

  /** Writes what is buffered (shutdown, tests). */
  flush(): Promise<void> {
    return this.buffer.flush();
  }

  private collect(request: FastifyRequest, reply: FastifyReply): void {
    try {
      const path = redactCredentials(stripQuery(request.url));
      if (!isTrackedPath(path)) return;
      const { auth } = request;
      // While impersonating, the action belongs to the superuser, not to the account shown.
      const userId = auth?.session?.impersonatorId ?? auth?.user._id ?? null;
      const userAgent = (request.headers['user-agent'] ?? '').slice(
        0,
        ACTIVITY_TEXT_MAX,
      );
      this.buffer.add({
        userId,
        sessionKey: activitySessionKey({
          sessionId: auth?.sessionId ?? null,
          userId,
          ip: request.ip,
          userAgent,
        }),
        ip: request.ip,
        userAgent,
        referer: redactCredentials(stripQuery(request.headers.referer ?? '')),
        path,
        method: request.method,
        statusCode: reply.statusCode,
        at: new Date(),
      });
    } catch (error) {
      this.logger.error(`Recording activity failed: ${describe(error)}`);
    }
  }

  /** The rows first (a failure drops the batch); the live view and the access time are best effort. */
  private async persist(rows: ActivityRow[]): Promise<void> {
    await this.writer.write(rows);
    const results = await Promise.allSettled([
      this.active.record(rows),
      this.touchUsers(rows),
    ]);
    for (const result of results)
      if (result.status === 'rejected')
        this.logger.error(
          `Updating the live view or access times failed for ${rows.length} rows: ${describe(result.reason)}`,
        );
  }

  /** `users.lastAccess` and `users.ip` at most once per `ACCESS_WRITE_SECONDS` per user: `SET NX EX` says who is due. The slot is claimed before the write, so a failed write leaves them stale for up to that long. */
  private async touchUsers(rows: ActivityRow[]): Promise<void> {
    const latest = new Map<string, ActivityRow>();
    for (const row of rows) if (row.userId) latest.set(row.userId, row);
    if (!latest.size) return;
    const pipeline = this.redis.multi();
    for (const userId of latest.keys())
      pipeline.set(
        `user-access:${userId}`,
        '1',
        'EX',
        ACCESS_WRITE_SECONDS,
        'NX',
      );
    const results = await execOrThrow(pipeline);
    const due = [...latest.values()].filter(
      (_row, index) => results[index] === 'OK',
    );
    await this.writer.touchUsers(
      due.map((row) => ({ userId: row.userId!, ip: row.ip, at: row.at })),
    );
  }
}
