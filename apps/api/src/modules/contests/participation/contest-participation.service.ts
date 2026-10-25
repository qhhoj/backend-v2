import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import {
  constantTimeEqual,
  SessionService,
  sha256,
  UsersRepository,
} from '@libs/auth';
import type { Principal, UserDocument } from '@libs/auth';
import {
  AppError,
  Paginated,
  RateLimitService,
  REDIS,
  unique,
} from '@libs/common';
import {
  CONTEST_RESCORE_QUEUE,
  contestPhase,
  hasParticipationEnded,
  isFrozenFor,
  isRegistrationOpen,
  LIVE,
  notifyContestRescore,
  purgeRankingCache,
  requiresRegistration,
  SPECTATE,
} from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestParticipation } from '@libs/database';
import { SettingsService } from '@libs/settings';
import type { FilterQuery } from 'mongoose';
import { ContestAccess } from '../core/contest-access';
import { ContestsRepository } from '../core/contests.repository';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import { CurrentContestService } from '../core/current-contest.service';
import { FeedKeysRepository } from '../feed/feed-keys.repository';
import { ParticipationSummaryResponse } from '../core/dto/contest-detail.response';
import type {
  BulkDisqualifyDto,
  ParticipationListQueryDto,
} from './dto/participation.dto';
import {
  refusal,
  rulesChanged,
  rulesNotAccepted,
} from './participation-refusals';
import {
  CurrentParticipationResponse,
  ParticipationResponse,
} from './dto/participation.response';
import type {
  BulkDisqualifyResponse,
  BulkDisqualifyResultResponse,
} from './dto/participation.response';
import type { BulkVisibilityOutcome } from '../../problems/bulk/dto/bulk-visibility.response';
import { ParticipationsRepository } from '../core/participations.repository';
import { recountParticipants } from '../core/participant-counts';
import type {
  ParticipationDocument,
  RulesAcceptance,
} from '../core/participations.repository';
import {
  ACCESS_CODE_IP_LIMIT,
  ACCESS_CODE_USER_LIMIT,
  ACCESS_CODE_WINDOW_SECONDS,
} from '../core/rate-limits';

/** Legacy `VNOJ_CONTEST_CHEATING_BAN_MESSAGE`. */
export const CONTEST_CHEATING_BAN_REASON =
  'Banned for multiple cheating offenses during contests';

/** `virtual` per listed kind; spectators are listed only on request. */
const VIRTUAL_OF_KIND = {
  any: { $gte: LIVE },
  live: LIVE,
  virtual: { $gt: LIVE },
  spectate: SPECTATE,
} as const;
/** Best first, like the ranking; the frozen fields while the viewer sees a frozen board. */
const SCORE_ORDER = { score: -1, cumtime: 1, tiebreaker: 1, _id: 1 } as const;
const FROZEN_SCORE_ORDER = {
  frozenScore: -1,
  frozenCumtime: 1,
  frozenTiebreaker: 1,
  _id: 1,
} as const;

/** Per user: each bulk run may disqualify up to 100 rows. */
const BULK_DISQUALIFY_LIMIT = 20;
const BULK_DISQUALIFY_WINDOW_SECONDS = 60 * 60;

const forbidden = (message: string) => new AppError('forbidden', 403, message);

/** What a register or join request brings besides the contest: the access code it typed and its address (rate limits). */
export interface JoinCredentials {
  accessCode: string | undefined;
  /** Whether the request ticked the rules box. */
  acceptRules: boolean;
  /** The rules revision the contestant read; absent from older clients. */
  acceptRulesRevision: number | undefined;
  ip: string;
}

/** The viewer, contest and request of one join. */
interface JoinContext {
  principal: Principal;
  contest: ContestDocument;
  credentials: JoinCredentials;
}

/** Legacy `ContestRegister`, `ContestJoin`, `ContestLeave` and `ContestParticipationList`. */
@Injectable()
export class ContestParticipationService {
  private readonly logger = new Logger(ContestParticipationService.name);

  constructor(
    private readonly contestsService: ContestsService,
    private readonly contests: ContestsRepository,
    private readonly participationRows: ParticipationsRepository,
    private readonly currentContest: CurrentContestService,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: SettingsService,
    private readonly sessions: SessionService,
    private readonly feedKeys: FeedKeysRepository,
  ) {}

  async register(
    principal: Principal,
    key: string,
    credentials: JoinCredentials,
    now = new Date(),
  ): Promise<ParticipationSummaryResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    this.assertMayRegister(principal, contest, now);
    if (
      await this.participationRows.findOne(contest._id, principal.userId, LIVE)
    )
      throw refusal('already_registered');
    await this.assertAccessCode(
      principal,
      contest,
      credentials.accessCode,
      credentials.ip,
    );
    const acceptance = this.acceptanceFor(contest, credentials, now);
    const participation = await this.participationRows.register(
      contest._id,
      principal.userId,
      contest.startTime,
      acceptance,
    );
    if (!participation) throw refusal('already_registered');
    await this.refreshCounts(contest._id);
    return ParticipationSummaryResponse.from(participation, contest);
  }

  private isEditorOrTester(
    principal: Principal,
    contest: ContestDocument,
  ): boolean {
    const view = ContestAccess.accessView(contest);
    return (
      ContestAccess.isEditor(principal, view) ||
      ContestAccess.isTester(principal, view)
    );
  }

  /** Legacy `ContestRegister` refusals, in legacy order. */
  private assertMayRegister(
    principal: Principal,
    contest: ContestDocument,
    now: Date,
  ): void {
    if (this.isEditorOrTester(principal, contest))
      throw refusal('editor_cannot_register');
    this.assertNotBanned(principal, contest);
    if (!requiresRegistration(contest))
      throw refusal('registration_not_required');
    if (!isRegistrationOpen(contest, now)) throw refusal('registration_closed');
    if (contestPhase(contest, now) === 'ended') throw refusal('contest_ended');
  }

  /** Legacy `join_contest`: a virtual run after the end (editors and testers spectate instead, ended or not), else the live participation; it becomes the current one. */
  async join(
    principal: Principal,
    key: string,
    credentials: JoinCredentials,
    now = new Date(),
  ): Promise<ParticipationSummaryResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const phase = contestPhase(contest, now);
    const isSpectatorOnly = this.isEditorOrTester(principal, contest);
    if (phase === 'upcoming' && !isSpectatorOnly)
      throw refusal('contest_not_started');
    this.assertNotBanned(principal, contest);
    const participation =
      phase === 'ended' && !isSpectatorOnly
        ? await this.joinVirtual(principal, contest, credentials, now)
        : await this.joinRunning(
            principal,
            contest,
            { isSpectatorOnly, credentials },
            now,
          );
    await this.participationRows.setCurrent(
      principal.userId,
      participation._id,
    );
    await this.refreshCounts(contest._id);
    return ParticipationSummaryResponse.from(participation, contest);
  }

  private async joinVirtual(
    principal: Principal,
    contest: ContestDocument,
    credentials: JoinCredentials,
    now: Date,
  ): Promise<ParticipationDocument> {
    if (contest.disallowVirtual) throw refusal('virtual_disallowed');
    await this.assertAccessCode(
      principal,
      contest,
      credentials.accessCode,
      credentials.ip,
    );
    return this.participationRows.createVirtual(
      contest._id,
      principal.userId,
      now,
      this.acceptanceFor(contest, credentials, now),
    );
  }

  /** Re-enters an existing row, else creates one behind the registration and access-code checks. */
  private async joinRunning(
    principal: Principal,
    contest: ContestDocument,
    {
      isSpectatorOnly,
      credentials,
    }: { isSpectatorOnly: boolean; credentials: JoinCredentials },
    now: Date,
  ): Promise<ParticipationDocument> {
    const virtual = isSpectatorOnly ? SPECTATE : LIVE;
    const existing = await this.participationRows.findOne(
      contest._id,
      principal.userId,
      virtual,
    );
    if (existing)
      return this.reenter({ principal, contest, credentials }, existing, now);
    const isRegistrationOver =
      requiresRegistration(contest) && !isRegistrationOpen(contest, now);
    if (isRegistrationOver && !isSpectatorOnly) throw refusal('not_registered');
    await this.assertAccessCode(
      principal,
      contest,
      credentials.accessCode,
      credentials.ip,
    );
    const acceptance = isSpectatorOnly
      ? null
      : this.acceptanceFor(contest, credentials, now);
    return this.participationRows.findOrCreate(
      { contestId: contest._id, userId: principal.userId, virtual },
      { now, acceptance },
    );
  }

  /** The acceptance to store with a new row: none when the contest has no rules; `rules_not_accepted` when it has and the request did not tick the box; `rules_changed` when the revision the request read is no longer the current one. A request without a revision (older client) is accepted as before and logged. */
  private acceptanceFor(
    contest: ContestDocument,
    { acceptRules, acceptRulesRevision }: JoinCredentials,
    now: Date,
  ): RulesAcceptance | null {
    if (contest.rules === '') return null;
    if (!acceptRules) throw rulesNotAccepted();
    if (acceptRulesRevision === undefined)
      this.logger.warn(`Rules accepted without a revision: ${contest.key}`);
    else if (acceptRulesRevision !== contest.rulesRevision)
      throw rulesChanged();
    return {
      rulesAcceptedAt: now,
      rulesAcceptedRevision: contest.rulesRevision,
    };
  }

  /** The first join after registering starts the clock, and asks for the rules again when they changed since the registration; a participation whose time ran out continues as a spectator. */
  private async reenter(
    { principal, contest, credentials }: JoinContext,
    existing: ParticipationDocument,
    now: Date,
  ): Promise<ParticipationDocument> {
    const isStale =
      contest.rules !== '' &&
      (existing.rulesAcceptedRevision ?? -1) < contest.rulesRevision;
    const started = existing.isRegistered
      ? await this.participationRows.start(
          existing,
          now,
          isStale ? this.acceptanceFor(contest, credentials, now) : null,
        )
      : existing;
    return hasParticipationEnded(contest, started, now)
      ? this.participationRows.findOrCreate(
          {
            contestId: contest._id,
            userId: principal.userId,
            virtual: SPECTATE,
          },
          { now, acceptance: null },
        )
      : started;
  }

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
    void notifyContestRescore(this.rescores, contest._id, this.logger);
  }

  /** Legacy `check_ban`, off unless the `contest.banAfterDisqualifications` setting is above 0: at the threshold the account is banned, unlisted, signed out everywhere and its API token revoked, like a staff ban, so the lift brings neither back; below it, only this ban is lifted, and the account is active again only if it was before the ban (as a manual unban). */
  private async checkCheatingBan(userId: string): Promise<void> {
    const limit = this.settings.get('contest.banAfterDisqualifications');
    if (!limit) return;
    const [count, user] = await Promise.all([
      this.participationRows.countOpenDisqualifications(userId),
      this.users.findById(userId),
    ]);
    if (!user) return;
    if (count >= limit && user.banReason === null)
      await this.banForCheating(user);
    else if (count < limit && user.banReason === CONTEST_CHEATING_BAN_REASON)
      await this.users.updateIfBanReason(userId, CONTEST_CHEATING_BAN_REASON, {
        banReason: null,
        displayRank: 'user',
        isUnlisted: false,
        isActive: user.isActiveBeforeBan ?? true,
        isActiveBeforeBan: null,
      });
  }

  /** Signs the user out only when this ban won the compare-and-set on the ban reason. */
  private async banForCheating(user: UserDocument): Promise<void> {
    if (
      await this.users.updateIfBanReason(user._id, null, {
        banReason: CONTEST_CHEATING_BAN_REASON,
        displayRank: 'banned',
        isUnlisted: true,
        isActive: false,
        isActiveBeforeBan: user.isActive,
        apiTokenHash: null,
      })
    ) {
      await this.sessions.destroyAllForUser(user._id);
      await this.feedKeys.revokeMintedBy(user._id, new Date());
    }
  }

  async leave(principal: Principal, key: string): Promise<void> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const pointer = await this.participationRows.currentIdOf(principal.userId);
    const participation = pointer
      ? await this.participationRows.findById(pointer)
      : null;
    if (
      !pointer ||
      !participation ||
      uuidStr(participation.contest) !== contest._id
    )
      throw refusal('not_in_contest');
    await this.participationRows.clearCurrent(principal.userId, pointer);
  }

  async current(
    principal: Principal,
  ): Promise<CurrentParticipationResponse | null> {
    const current = await this.currentContest.current(principal);
    if (!current) return null;
    const { contest, participation } = current;
    return {
      contest: {
        key: contest.key,
        name: contest.name,
        startTime: contest.startTime,
        endTime: contest.endTime,
      },
      participation: ParticipationSummaryResponse.from(participation, contest),
    };
  }

  /** Own participations, or anyone's for contest editors; non-editors see frozen results during a freeze. */
  async participations(
    principal: Principal,
    key: string,
    query: ParticipationListQueryDto,
    now = new Date(),
  ): Promise<Paginated<ParticipationResponse>> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const canEdit = ContestAccess.canEdit(
      principal,
      ContestAccess.accessView(contest),
    );
    const meta = { page: query.page, pageSize: query.pageSize };
    const filter = await this.listFilter(principal, contest, query, canEdit);
    if (!filter) return new Paginated([], { ...meta, total: 0 });
    const frozen = isFrozenFor(contest, now, canEdit);
    const scoreOrder = frozen ? FROZEN_SCORE_ORDER : SCORE_ORDER;
    const { items, total } = await this.participationRows.list(
      filter,
      query.page,
      query.pageSize,
      query.sort === 'score' ? scoreOrder : undefined,
    );
    const summaries = await this.participationRows.summariesOf(
      items.map((item) => uuidStr(item.user)),
    );
    return new Paginated(
      items.map((item) => {
        const userId = uuidStr(item.user);
        return ParticipationResponse.withUser(
          item,
          contest,
          summaries.get(userId) ?? { id: userId, username: '', rating: null },
          frozen,
        );
      }),
      { ...meta, total },
    );
  }

  /** The list's filter; null when the named user does not exist. Other users than the viewer need edit rights. */
  private async listFilter(
    principal: Principal,
    contest: ContestDocument,
    query: ParticipationListQueryDto,
    canEdit: boolean,
  ): Promise<FilterQuery<ContestParticipation> | null> {
    const filter: FilterQuery<ContestParticipation> = {
      contest: contest._id,
      virtual: VIRTUAL_OF_KIND[query.kind ?? 'any'],
      ...(query.disqualified === undefined
        ? {}
        : { isDisqualified: query.disqualified }),
    };
    if (query.user !== undefined && query.user !== principal.username) {
      if (!canEdit)
        throw forbidden('You can only see your own participations.');
      const user = await this.users.findByUsername(query.user);
      if (!user) return null;
      filter.user = user._id;
    } else if (!canEdit || query.user !== undefined)
      filter.user = principal.userId;
    const search = query.search?.trim();
    if (search) {
      if (!canEdit) throw forbidden('Only contest editors may search.');
      const ids = await this.participationRows.userIdsMatching(
        contest._id,
        search,
      );
      filter.$and = [{ user: { $in: ids } }];
    }
    return filter;
  }

  private assertNotBanned(
    principal: Principal,
    contest: ContestDocument,
  ): void {
    if (
      !principal.isSuperuser &&
      contest.bannedUsers.map(uuidStr).includes(principal.userId)
    )
      throw refusal('banned_from_contest');
  }

  /** Editors skip the code; a missing code costs nothing; each wrong code spends the user's and the IP's budget, a right one gives it back. */
  private async assertAccessCode(
    principal: Principal,
    contest: ContestDocument,
    accessCode: string | undefined,
    ip: string,
  ): Promise<void> {
    if (
      contest.accessCodeHash === null ||
      ContestAccess.canEdit(principal, ContestAccess.accessView(contest))
    )
      return;
    if (accessCode === undefined) throw refusal('access_code_required');
    const releaseUser = await this.rateLimit.reserve(
      [`contest-code:user:${principal.userId}`],
      ACCESS_CODE_USER_LIMIT,
      ACCESS_CODE_WINDOW_SECONDS,
    );
    const releaseIp = await this.rateLimit.reserve(
      [`contest-code:ip:${ip}`],
      ACCESS_CODE_IP_LIMIT,
      ACCESS_CODE_WINDOW_SECONDS,
    );
    if (!constantTimeEqual(sha256(accessCode), contest.accessCodeHash))
      throw refusal('wrong_access_code');
    await Promise.all([releaseUser(), releaseIp()]);
  }

  private refreshCounts(contestId: string): Promise<void> {
    return recountParticipants(
      this.redis,
      { contests: this.contests, participations: this.participationRows },
      contestId,
    );
  }
}
