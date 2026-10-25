import { Injectable } from '@nestjs/common';
import {
  constantTimeEqual,
  PrincipalService,
  sha256,
  UsersRepository,
} from '@libs/auth';
import { AppError, limiterAddress, RateLimitService } from '@libs/common';
import { ContestAccess } from '../core/contest-access';
import { ContestsRepository } from '../core/contests.repository';
import type { ContestDocument } from '../core/contests.repository';
import { FEED_USERNAME, isFeedKeyUsable, parseBasicAuth } from './feed-key';
import { FeedKeysRepository } from './feed-keys.repository';
import type { FeedKeyRecord } from './feed-keys.repository';
import {
  FEED_FAIL_LIMIT,
  FEED_FAIL_WINDOW_SECONDS,
  FEED_KEY_LIMIT,
  FEED_KEY_WINDOW_SECONDS,
} from './rate-limits';

export interface FeedContext {
  contest: ContestDocument;
  feedKey: FeedKeyRecord;
}
export interface FeedRequest {
  authorization: string | undefined;
  ip: string;
}

/** Compared when no key exists, so an unknown contest costs what a wrong key costs. */
const ABSENT_KEY_HASH = sha256('no feed key');

const passwordMatches = (
  credentials: { password: string } | null,
  feedKey: FeedKeyRecord | null,
): boolean =>
  constantTimeEqual(
    sha256(credentials?.password ?? ''),
    feedKey?.keyHash ?? ABSENT_KEY_HASH,
  );

const isFeedLogin = (
  credentials: { username: string } | null,
  isRightKey: boolean,
): boolean =>
  credentials !== null && credentials.username === FEED_USERNAME && isRightKey;

/** Every refusal is this one answer: nothing tells a caller which part was wrong. */
const unauthorized = () =>
  new AppError('unauthorized', 401, 'Invalid feed key', undefined, {
    'WWW-Authenticate': 'Basic realm="feed"',
  });

@Injectable()
export class FeedAuthService {
  constructor(
    private readonly contests: ContestsRepository,
    private readonly keys: FeedKeysRepository,
    private readonly users: UsersRepository,
    private readonly principals: PrincipalService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** HTTP Basic, user `feed`, password the contest's newest feed key. Every attempt spends one per-IP budget before the contest is looked up (a right key gives its hit back), so a locked IP gets the same 429 for every contest key, real, hidden or made up, and the answer never tells whether a contest exists. A right key then spends the key's own request budget. */
  async authorize(
    request: FeedRequest,
    contestKey: string,
    now = new Date(),
  ): Promise<FeedContext> {
    const release = await this.rateLimit.reserve(
      [`feed-fail:${limiterAddress(request.ip)}`],
      FEED_FAIL_LIMIT,
      FEED_FAIL_WINDOW_SECONDS,
    );
    const contest = await this.contests.findByKey(contestKey);
    const context = await this.verified(request.authorization, contest, now);
    await release();
    await this.rateLimit.reserve(
      [`feed-key:${context.feedKey.id}`],
      FEED_KEY_LIMIT,
      FEED_KEY_WINDOW_SECONDS,
    );
    return context;
  }

  /** For a stream tick: the same qualifications, none of the request budgets. */
  async reauthorize(
    contestId: string,
    feedKeyId: string,
    now = new Date(),
  ): Promise<FeedContext> {
    const contest = await this.contests.findById(contestId);
    const feedKey = await this.keys.findById(feedKeyId);
    const newest = contest && (await this.keys.findNewest(contest._id));
    if (!contest || !feedKey || newest?.id !== feedKey.id) throw unauthorized();
    return this.qualified(contest, feedKey, now);
  }

  private async verified(
    header: string | undefined,
    contest: ContestDocument | null,
    now: Date,
  ): Promise<FeedContext> {
    const credentials = parseBasicAuth(header);
    const feedKey = contest && (await this.keys.findNewest(contest._id));
    const isRightKey = passwordMatches(credentials, feedKey);
    if (!contest || !feedKey || !isFeedLogin(credentials, isRightKey))
      throw unauthorized();
    return this.qualified(contest, feedKey, now);
  }

  /** Not expired or revoked, and its owner is still an active editor of the contest. */
  private async qualified(
    contest: ContestDocument,
    feedKey: FeedKeyRecord,
    now: Date,
  ): Promise<FeedContext> {
    if (!isFeedKeyUsable(feedKey, now)) throw unauthorized();
    const owner = await this.users.findById(feedKey.createdBy);
    if (!owner?.isActive) throw unauthorized();
    const view = ContestAccess.accessView(contest);
    if (!ContestAccess.canEdit(this.principals.build(owner), view))
      throw unauthorized();
    return { contest, feedKey };
  }
}
