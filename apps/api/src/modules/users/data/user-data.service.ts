import { createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { once } from 'node:events';
import { stat } from 'node:fs/promises';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, ENV, RateLimitService } from '@libs/common';
import type { Env } from '@libs/common';
import {
  canPrepareUserData,
  isUserDataExpired,
  USER_DATA_JOB,
  USER_DATA_PREPARE_INTERVAL_MS,
  USER_DATA_QUEUE,
  USER_DATA_TTL_MS,
  userDataJobId,
  userDataPath,
  oneJobPerUser,
} from '@libs/community';
import type { UserDataJob } from '@libs/community';
import type { QueuedResponse } from '../../contests/core/dto/queued.response';
import {
  USER_DATA_PREPARE_LIMIT,
  USER_DATA_PREPARE_WINDOW_SECONDS,
} from '../core/rate-limits';
import type { UserDataStatusResponse } from './dto/user-data.response';

const dailyKey = (userId: string) => `user-data:user:${userId}`;

@Injectable()
export class UserDataService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly users: UsersRepository,
    private readonly rateLimits: RateLimitService,
    @InjectQueue(USER_DATA_QUEUE) private readonly queue: Queue<UserDataJob>,
  ) {}

  async status(
    principal: Principal,
    now = new Date(),
  ): Promise<UserDataStatusResponse> {
    const { user, root } = await this.exporter(principal);
    const file = await this.freshZip(root, user._id, now);
    const preparing =
      (await this.queue.getJob(userDataJobId(user._id))) !== undefined;
    const preparedAt = user.dataLastDownloaded;
    const dailyLimitUsed =
      (await this.rateLimits.count(dailyKey(user._id))) >=
      USER_DATA_PREPARE_LIMIT;
    const nextPrepareAt = canPrepareUserData(preparedAt, file !== null, now)
      ? null
      : new Date(
          preparedAt!.getTime() + USER_DATA_PREPARE_INTERVAL_MS,
        ).toISOString();
    return {
      state: preparing ? 'preparing' : file ? 'ready' : 'none',
      preparedAt: preparedAt?.toISOString() ?? null,
      readyAt: file?.mtime.toISOString() ?? null,
      expiresAt: file
        ? new Date(file.mtime.getTime() + USER_DATA_TTL_MS).toISOString()
        : null,
      size: file?.size ?? null,
      nextPrepareAt,
      canPrepare: !preparing && nextPrepareAt === null && !dailyLimitUsed,
    };
  }

  async prepare(
    principal: Principal,
    now = new Date(),
  ): Promise<QueuedResponse> {
    const { user, root } = await this.exporter(principal);
    if (await this.queue.getJob(userDataJobId(user._id)))
      throw new AppError('conflict', 409, 'Your data is being prepared');
    if (
      !canPrepareUserData(
        user.dataLastDownloaded,
        (await this.freshZip(root, user._id, now)) !== null,
        now,
      )
    )
      throw new AppError(
        'rate_limited',
        429,
        'Your data can be prepared once a day',
      );
    await this.rateLimits.reserve(
      [dailyKey(user._id)],
      USER_DATA_PREPARE_LIMIT,
      USER_DATA_PREPARE_WINDOW_SECONDS,
    );
    await this.users.update(user._id, { dataLastDownloaded: now });
    await this.queue.add(
      USER_DATA_JOB,
      { userId: user._id },
      oneJobPerUser(user._id),
    );
    return { queued: true };
  }

  /** Opened here, so a zip that vanishes (a prepare starting, the sweep) is a 404, never a failed response. */
  async download(
    principal: Principal,
    now = new Date(),
  ): Promise<{ stream: ReadStream; filename: string }> {
    const { user, root } = await this.exporter(principal);
    if (!(await this.freshZip(root, user._id, now)))
      throw new AppError('not_found', 404, 'No data has been prepared');
    const stream = createReadStream(userDataPath(root, user._id));
    try {
      await once(stream, 'open');
    } catch {
      stream.destroy();
      throw new AppError('not_found', 404, 'No data has been prepared');
    }
    return { stream, filename: `${user.username}-data.zip` };
  }

  /** Legacy `UserDataMixin`: off without a root, hidden from muted users. */
  private async exporter(principal: Principal) {
    const root = this.env.userDataRoot;
    const user = await this.users.findById(principal.userId);
    if (!root || !user || user.mute)
      throw new AppError('not_found', 404, 'User data export is not available');
    return { user, root };
  }

  private async freshZip(root: string, userId: string, now: Date) {
    const file = await stat(userDataPath(root, userId)).catch(() => null);
    return file && !isUserDataExpired(file.mtime, now) ? file : null;
  }
}
