import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { constantTimeEqual, sha256, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, Paginated, RateLimitService, REDIS } from '@libs/common';
import {
  contestPhase,
  hasParticipationEnded,
  isFrozenFor,
  isRegistrationOpen,
  LIVE,
  requiresRegistration,
  SPECTATE,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { ContestParticipation } from '@libs/database';
import type { FilterQuery } from 'mongoose';
import { ContestAccess } from '../core/contest-access';
import { ContestsRepository } from '../core/contests.repository';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import { ContestRankingService } from '../ranking/contest-ranking.service';
import { CurrentContestService } from '../core/current-contest.service';
import { ParticipationSummaryResponse } from '../core/dto/contest-detail.response';
import type { ParticipationListQueryDto } from './dto/participation.dto';
import {
  refusal,
  rulesChanged,
  rulesNotAccepted,
} from './participation-refusals';
import {
  CurrentParticipationResponse,
  ParticipationResponse,
} from './dto/participation.response';
import { ParticipationsRepository } from '../core/participations.repository';
import { recountParticipants } from '../core/participant-counts';
import type {
  ParticipationDocument,
  RulesAcceptance,
} from '../core/participations.repository';
import {
  ACCESS_CODE_IP_LIMIT,
  ACCESS_CODE_USER_LIMIT,
  JOIN_USER_LIMIT,
  JOIN_WINDOW_SECONDS,
  VIRTUAL_RUN_DAILY_LIMIT,
  VIRTUAL_RUN_WINDOW_SECONDS,
  ACCESS_CODE_WINDOW_SECONDS,
} from '../core/rate-limits';

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

const forbidden = (message: string) => new AppError('forbidden', 403, message);

/** What a register or join request brings besides the contest: the access code it typed and its address (rate limits). */
export interface JoinCredentials {
  accessCode: string | undefined;
  /** Whether the request ticked the rules box. */
  acceptRules: boolean;
  /** The rules revision the contestant read; absent from older clients, which are refused. */
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
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contests: ContestsRepository,
    private readonly participationRows: ParticipationsRepository,
    private readonly currentContest: CurrentContestService,
    private readonly users: UsersRepository,
    private readonly rateLimit: RateLimitService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly ranking: ContestRankingService,
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
    this.assertMayCompete(principal, contest);
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
    await this.rateLimit.reserve(
      [`contest-join:user:${principal.userId}`],
      JOIN_USER_LIMIT,
      JOIN_WINDOW_SECONDS,
    );
    const contest = await this.contestsService.visibleContest(principal, key);
    const phase = contestPhase(contest, now);
    const isSpectatorOnly = this.isEditorOrTester(principal, contest);
    if (phase === 'upcoming' && !isSpectatorOnly)
      throw refusal('contest_not_started');
    this.assertMayCompete(principal, contest);
    const participation =
      phase === 'ended' && !isSpectatorOnly
        ? await this.joinVirtual(principal, contest, credentials, now)
        : await this.joinRunning(
            principal,
            contest,
            { isSpectatorOnly, credentials },
            now,
          );
    const previous = await this.participationRows.setCurrent(
      principal.userId,
      participation._id,
    );
    if (previous && previous !== uuidStr(participation._id))
      await this.participationRows.markLeft(previous, now);
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
      {
        acceptance: this.acceptanceFor(contest, credentials, now),
        reuse: {
          isLive: (latest) => !hasParticipationEnded(contest, latest, now),
        },
        beforeInsert: async () => {
          await this.rateLimit.reserve(
            [`contest-virtual:user:${principal.userId}`],
            VIRTUAL_RUN_DAILY_LIMIT,
            VIRTUAL_RUN_WINDOW_SECONDS,
          );
        },
      },
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

  /** The acceptance to store with a new row: none when the contest has no rules; `rules_not_accepted` when it has and the request did not tick the box; `rules_changed` when the revision the request read is no longer the current one. A request without a revision (a client from an older cached bundle) is refused with `rules_changed`, so it reloads the rules and asks again. */
  private acceptanceFor(
    contest: ContestDocument,
    { acceptRules, acceptRulesRevision }: JoinCredentials,
    now: Date,
  ): RulesAcceptance | null {
    if (contest.rules === '') return null;
    if (!acceptRules) throw rulesNotAccepted();
    if (acceptRulesRevision !== contest.rulesRevision) throw rulesChanged();
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
    await this.participationRows.markLeft(pointer, new Date());
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
      standing: await this.ranking.ownStanding(
        principal,
        contest,
        participation,
      ),
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

  /** Invited (`ContestAccess.canCompete`) and not banned. */
  private assertMayCompete(
    principal: Principal,
    contest: ContestDocument,
  ): void {
    if (!ContestAccess.canCompete(principal, ContestAccess.accessView(contest)))
      throw refusal('not_invited');
    if (ContestAccess.isBannedFrom(principal, contest))
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
