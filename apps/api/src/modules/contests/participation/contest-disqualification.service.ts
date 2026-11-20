import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PrincipalService, shieldingRights, UsersRepository } from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import {
  AppError,
  InjectJob,
  RateLimitService,
  REDIS,
  unique,
} from '@libs/common';
import type { JobProducer } from '@libs/common';
import { contestJobs, purgeRankingCache } from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { SettingsService } from '@libs/settings';
import { ContestsRepository } from '../core/contests.repository';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import {
  AccountBans,
  CONTEST_CHEATING_BAN_REASON,
} from '../../users/moderation/account-bans.service';
import { ParticipationSummaryResponse } from '../core/dto/contest-detail.response';
import type { BulkDisqualifyDto } from './dto/participation.dto';
import type {
  BulkDisqualifyResponse,
  BulkDisqualifyResultResponse,
} from './dto/participation.response';
import type { BulkVisibilityOutcome } from '../../problems/bulk/dto/bulk-visibility.response';
import { ParticipationsRepository } from '../core/participations.repository';
import type { ParticipationDocument } from '../core/participations.repository';

/** Per user: each bulk run may disqualify up to 100 rows. */
const BULK_DISQUALIFY_LIMIT = 20;
const BULK_DISQUALIFY_WINDOW_SECONDS = 60 * 60;

/** Disqualifying participants (one or a bulk run) and the cheating ban that follows. */
@Injectable()
export class ContestDisqualificationService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contests: ContestsRepository,
    private readonly participationRows: ParticipationsRepository,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
    @InjectJob(contestJobs.rescore)
    private readonly rescores: JobProducer<ContestRescoreJob>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: SettingsService,
    private readonly bans: AccountBans,
    private readonly principals: PrincipalService,
  ) {}

  /** Legacy `set_disqualified`, with an explicit value instead of a toggle: rescored at -9999 (or back) by the worker, banned from (or allowed back into) the contest and moved out of it, then the cheating ban. */
  async disqualify(
    principal: Principal,
    key: string,
    participationId: string,
    isDisqualified: boolean,
  ): Promise<ParticipationSummaryResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const { updated, userId } = await this.applyDisqualified(
      contest,
      participationId,
      isDisqualified,
    );
    await this.afterDisqualifying(contest);
    await this.checkCheatingBans(contest, [userId]);
    return ParticipationSummaryResponse.from(updated, contest);
  }

  /** `disqualify` for many rows of one contest, one after another; an id not in the contest is reported and the rest still apply. The ranking is purged and rescored once, even when a later row fails unexpectedly, then each changed user's cheating ban is checked. */
  async disqualifyMany(
    principal: Principal,
    key: string,
    { ids, disqualified }: BulkDisqualifyDto,
  ): Promise<BulkDisqualifyResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    await this.rateLimit.reserve(
      [`participations-bulk-disqualify:user:${principal.userId}`],
      BULK_DISQUALIFY_LIMIT,
      BULK_DISQUALIFY_WINDOW_SECONDS,
    );
    const results: BulkDisqualifyResultResponse[] = [];
    const changedUsers: string[] = [];
    try {
      for (const id of ids)
        results.push(
          await this.disqualifyOne(contest, id, disqualified, changedUsers),
        );
    } finally {
      if (changedUsers.length > 0) await this.afterDisqualifying(contest);
    }
    await this.checkCheatingBans(contest, unique(changedUsers));
    const count = (outcome: BulkVisibilityOutcome) =>
      results.filter((result) => result.outcome === outcome).length;
    return { results, done: count('done'), failed: count('failed') };
  }

  /** Records the user of a changed row in `changedUsers`. */
  private async disqualifyOne(
    contest: ContestDocument,
    id: string,
    isDisqualified: boolean,
    changedUsers: string[],
  ): Promise<BulkDisqualifyResultResponse> {
    try {
      const { wasSet, userId } = await this.applyDisqualified(
        contest,
        id,
        isDisqualified,
      );
      if (wasSet) return { id, outcome: 'unchanged' };
      changedUsers.push(userId);
      return { id, outcome: 'done' };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return { id, outcome: 'failed', reason: error.code };
    }
  }

  /** Writes the flag and the contest ban and clears the user's current contest when disqualified; `wasSet` tells the flag already had the value. */
  private async applyDisqualified(
    contest: ContestDocument,
    participationId: string,
    isDisqualified: boolean,
  ): Promise<{
    updated: ParticipationDocument;
    wasSet: boolean;
    userId: string;
  }> {
    const participation =
      await this.participationRows.findById(participationId);
    if (!participation || uuidStr(participation.contest) !== contest._id)
      throw new AppError('not_found', 404, 'No such participation');
    const userId = uuidStr(participation.user);
    let updated = await this.participationRows.setDisqualified(
      participation._id,
      isDisqualified,
    );
    // Concurrent opposite requests: write the ban from the row's state, and repeat until a re-read agrees.
    for (
      let written: boolean | null = null;
      written !== updated.isDisqualified;
    ) {
      written = updated.isDisqualified;
      await this.contests.setBanned(contest._id, userId, written);
      updated =
        (await this.participationRows.findById(participation._id)) ?? updated;
    }
    if (updated.isDisqualified)
      await this.participationRows.clearCurrent(userId, participation._id);
    const wasSet = participation.isDisqualified === isDisqualified;
    return { updated, wasSet, userId };
  }

  /** Organization-private contests never count towards the cheating ban. */
  private async checkCheatingBans(
    contest: ContestDocument,
    userIds: string[],
  ): Promise<void> {
    if (contest.isOrganizationPrivate) return;
    for (const userId of userIds) await this.checkCheatingBan(userId);
  }

  private async afterDisqualifying(contest: ContestDocument): Promise<void> {
    await purgeRankingCache(this.redis, contest._id);
    void this.rescores.enqueue({ contestId: contest._id });
  }

  /** Legacy `check_ban`, off unless the `contest.banAfterDisqualifications` setting is above 0: at the threshold the account is banned, unlisted, signed out everywhere and its API token revoked, like a staff ban, so the lift brings neither back; below it, only this ban is lifted, and the account is active again only if it was before the ban (as a manual unban). Staff accounts are never banned this way: a staff ban needs a moderator holding their rights. */
  private async checkCheatingBan(userId: string): Promise<void> {
    const limit = this.settings.get('contest.banAfterDisqualifications');
    if (!limit) return;
    const [count, user] = await Promise.all([
      this.participationRows.countOpenDisqualifications(userId),
      this.users.findById(userId),
    ]);
    if (!user) return;
    if (count >= limit && user.banReason === null && !this.isStaffAccount(user))
      await this.bans.ban(user, CONTEST_CHEATING_BAN_REASON);
    else if (count < limit && user.banReason === CONTEST_CHEATING_BAN_REASON)
      await this.bans.unban(user);
  }

  /** Superusers, `isStaff` accounts and holders of any right beyond the own-scope ones (directly or through a role). */
  private isStaffAccount(user: UserDocument): boolean {
    return (
      user.isSuperuser ||
      user.isStaff ||
      shieldingRights(this.principals.build(user).permissions).length > 0
    );
  }
}
