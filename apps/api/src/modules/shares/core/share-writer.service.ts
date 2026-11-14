import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  isDuplicateKey,
  issueError,
  RateLimitService,
  REDIS,
  retryOnDuplicateKey,
  TUNING,
  withRedisLock,
} from '@libs/common';
import type { Share } from '@libs/database';
import {
  ACTIVE_SHARE_LIMIT,
  CREATE_BURST_LIMIT,
  CREATE_BURST_WINDOW_SECONDS,
  CREATE_DAILY_LIMIT,
  CREATE_DAILY_WINDOW_SECONDS,
  CREATE_LOCK_SECONDS,
  CREATE_LOCK_WAIT_SECONDS,
  MAX_CODE_ATTEMPTS,
} from './rate-limits';
import type { ShareCodeTuning } from './share-code';
import { SharesRepository } from './shares.repository';
import type { ShareDocument } from './shares.repository';

export type NewShare = Omit<
  Share,
  '_id' | 'code' | 'createdBy' | 'takenDown' | 'createdAt' | 'updatedAt'
>;

/** 403 `forbidden` whose issue code `muted` tells the SPA a mute from a missing right (the ticket gate's answer). */
const mutedError = () =>
  issueError('forbidden', 403, {
    field: '',
    code: 'muted',
    message: 'Muted users cannot share code',
  });

/** Every new share, of either kind: the user's gates and budgets, then an insert under a fresh code. */
@Injectable()
export class ShareWriterService {
  constructor(
    private readonly shares: SharesRepository,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
    @Inject(TUNING) private readonly tuning: ShareCodeTuning,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * 403 for a muted user, 409 `conflict` (issue `share_limit`) at `ACTIVE_SHARE_LIMIT` unexpired shares, 429 over the
   * create budgets; a create that fails after the claim gives its hits back. The count and the insert run under the
   * user's lock, so parallel creates cannot pass the cap together.
   */
  async insert(
    principal: Principal,
    fields: NewShare,
    now: Date,
  ): Promise<ShareDocument> {
    if ((await this.users.signedIn(principal)).mute) throw mutedError();
    return withRedisLock(
      this.redis,
      {
        key: `share-create-lock:user:${principal.userId}`,
        ttlSeconds: CREATE_LOCK_SECONDS,
        waitSeconds: CREATE_LOCK_WAIT_SECONDS,
        renew: true,
        busyMessage: 'Another link is being created; try again',
      },
      () => this.insertUnderCap(principal.userId, fields, now),
    );
  }

  private async insertUnderCap(
    userId: string,
    fields: NewShare,
    now: Date,
  ): Promise<ShareDocument> {
    await this.assertUnderCap(userId, now);
    const release = await this.claimCreate(userId);
    try {
      return await this.insertUnderFreshCode({
        ...fields,
        createdBy: userId,
      });
    } catch (error) {
      await release();
      throw error;
    }
  }

  private async assertUnderCap(userId: string, now: Date): Promise<void> {
    const active = await this.shares.countActive(userId, now);
    if (active >= ACTIVE_SHARE_LIMIT)
      throw issueError('conflict', 409, {
        field: '',
        code: 'share_limit',
        message: `At most ${ACTIVE_SHARE_LIMIT} links may be active; delete one first`,
      });
  }

  /** Two windows, so two claims; a refused claim costs nothing, and the first is given back when the second refuses. */
  private async claimCreate(userId: string): Promise<() => Promise<void>> {
    const releaseDaily = await this.rateLimit.claim(
      [{ key: `share-create:day:${userId}`, limit: CREATE_DAILY_LIMIT }],
      CREATE_DAILY_WINDOW_SECONDS,
    );
    try {
      const releaseBurst = await this.rateLimit.claim(
        [{ key: `share-create:burst:${userId}`, limit: CREATE_BURST_LIMIT }],
        CREATE_BURST_WINDOW_SECONDS,
      );
      return async () => {
        await Promise.all([releaseDaily(), releaseBurst()]);
      };
    } catch (error) {
      await releaseDaily();
      throw error;
    }
  }

  private async insertUnderFreshCode(
    fields: Partial<Share>,
  ): Promise<ShareDocument> {
    try {
      return await retryOnDuplicateKey(
        () =>
          this.shares.create({
            ...fields,
            code: this.tuning.shareCodes.next(),
          }),
        MAX_CODE_ATTEMPTS,
        'code',
      );
    } catch (error) {
      if (!isDuplicateKey(error, 'code')) throw error;
      throw new AppError(
        'conflict',
        409,
        'Could not find a free share code; try again',
      );
    }
  }
}
