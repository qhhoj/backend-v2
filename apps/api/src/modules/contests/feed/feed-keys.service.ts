import { Injectable, Logger } from '@nestjs/common';
import { sha256, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { isFrozen } from '@libs/contests';
import { ContestViewerService } from '../core/contest-viewer.service';
import type {
  FeedKeyStatusResponse,
  MintedFeedKeyResponse,
  MintFeedKeyDto,
} from './dto/feed-key.dto';
import {
  FEED_USERNAME,
  feedKeyExpiry,
  generateFeedKey,
  isFeedKeyUsable,
} from './feed-key';
import { FeedKeysRepository } from './feed-keys.repository';
import { FEED_MINT_LIMIT, FEED_MINT_WINDOW_SECONDS } from './rate-limits';

@Injectable()
export class FeedKeysService {
  private readonly logger = new Logger(FeedKeysService.name);

  constructor(
    private readonly viewers: ContestViewerService,
    private readonly keys: FeedKeysRepository,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
  ) {}

  async status(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<FeedKeyStatusResponse> {
    const contest = await this.viewers.editableContest(principal, key);
    const newest = await this.keys.findNewest(contest._id);
    if (!newest || !isFeedKeyUsable(newest, now))
      return {
        isActive: false,
        mode: null,
        expiresAt: null,
        releasedAt: null,
        createdBy: null,
      };
    const owner = await this.users.findById(newest.createdBy);
    return {
      isActive: true,
      mode: newest.mode,
      expiresAt: newest.expiresAt.toISOString(),
      releasedAt: newest.releasedAt?.toISOString() ?? null,
      createdBy: owner?.username ?? null,
    };
  }

  /** The key is returned here and nowhere else; only its sha256 is stored. Earlier keys of the contest stop working. */
  async mint(
    principal: Principal,
    key: string,
    dto: MintFeedKeyDto,
    now = new Date(),
  ): Promise<MintedFeedKeyResponse> {
    const contest = await this.viewers.editableContest(principal, key);
    await this.rateLimit.reserve(
      [`feed-mint:${contest._id}:${principal.userId}`],
      FEED_MINT_LIMIT,
      FEED_MINT_WINDOW_SECONDS,
    );
    const secret = generateFeedKey();
    const mode = dto.mode ?? 'frozen-until-release';
    const expiresAt = feedKeyExpiry(now, dto.expiresInDays);
    await this.keys.mint(
      contest._id,
      { keyHash: sha256(secret), mode, createdBy: principal.userId, expiresAt },
      now,
    );
    this.logger.log({
      event: 'feed-key.minted',
      contestId: contest._id,
      actorId: principal.userId,
      mode,
      expiresAt: expiresAt.toISOString(),
    });
    return {
      username: FEED_USERNAME,
      key: secret,
      mode,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revoke(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<void> {
    const contest = await this.viewers.editableContest(principal, key);
    const revoked = await this.keys.revokeAll(contest._id, now);
    this.logger.log({
      event: 'feed-key.revoked',
      contestId: contest._id,
      actorId: principal.userId,
      revoked,
    });
  }

  /** "Release to resolver": the feed stops being cut at the freeze in progress. 409 when there is no usable key, and 409 `not_frozen` when no freeze is on: a release applies to the current freeze only (the feed gate checks `releasedAt >= frozenTime`), never to a later one. */
  async release(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<void> {
    const contest = await this.viewers.editableContest(principal, key);
    const newest = await this.keys.findNewest(contest._id);
    if (!newest || !isFeedKeyUsable(newest, now))
      throw new AppError(
        'no_active_feed_key',
        409,
        'There is no active feed key to release',
      );
    if (!isFrozen(contest, now))
      throw new AppError(
        'not_frozen',
        409,
        'The contest is not frozen; a release applies to a freeze in progress',
      );
    await this.keys.release(newest.id, now);
    this.logger.log({
      event: 'feed-key.released',
      contestId: contest._id,
      actorId: principal.userId,
    });
  }
}
