import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { constantTimeEqual, sha256, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import {
  AppError,
  ENV,
  Paginated,
  RateLimitService,
  REDIS,
} from '@libs/common';
import type { Env } from '@libs/common';
import {
  CONTEST_RESCORE_QUEUE,
  contestPhase,
  hasParticipationEnded,
  isFrozen,
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
import type { FilterQuery } from 'mongoose';
import { ContestAccess } from './contest-access';
import { ContestsRepository } from './contests.repository';
import type { ContestDocument } from './contests.repository';
import { ContestsService } from './contests.service';
import { CurrentContestService } from './current-contest.service';
import { ParticipationSummaryResponse } from './dto/contest-detail.response';
import type { ParticipationListQueryDto } from './dto/participation.dto';
import {
  CurrentParticipationResponse,
  ParticipationResponse,
} from './dto/participation.response';
import { ParticipationsRepository } from './participations.repository';
import type { ParticipationDocument } from './participations.repository';
import {
  ACCESS_CODE_IP_LIMIT,
  ACCESS_CODE_USER_LIMIT,
  ACCESS_CODE_WINDOW_SECONDS,
} from './rate-limits';

/** Legacy `VNOJ_CONTEST_CHEATING_BAN_MESSAGE`. */
export const CONTEST_CHEATING_BAN_REASON =
  'Banned for multiple cheating offenses during contests';

const conflict = (message: string) => new AppError('conflict', 409, message);
const forbidden = (message: string) => new AppError('forbidden', 403, message);

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
    @Inject(ENV) private readonly env: Env,
  ) {}

  async register(
    principal: Principal,
    key: string,
    accessCode: string | undefined,
    ip: string,
    now = new Date(),
  ): Promise<ParticipationSummaryResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const view = ContestAccess.accessView(contest);
    if (
      ContestAccess.isEditor(principal, view) ||
      ContestAccess.isTester(principal, view)
    )
      throw conflict('Editors and testers cannot register.');
    this.assertNotBanned(principal, contest);
    if (!requiresRegistration(contest))
      throw conflict('Registration is not required for this contest.');
    if (
      !isRegistrationOpen(contest, now) ||
      contestPhase(contest, now) === 'ended'
    )
      throw conflict('Registration is closed.');
    if (
      await this.participationRows.findOne(contest._id, principal.userId, LIVE)
    )
      throw conflict('You have already registered for this contest.');
    await this.assertAccessCode(principal, contest, accessCode, ip);
    const participation = await this.participationRows.register(
      contest._id,
      principal.userId,
      contest.startTime,
    );
    if (!participation)
      throw conflict('You have already registered for this contest.');
    await this.refreshCounts(contest._id);
    return ParticipationSummaryResponse.from(participation, contest);
  }

  /** Legacy `join_contest`: a virtual run after the end, else the live (or, for editors and testers, spectating) participation; it becomes the current one. */
  async join(
    principal: Principal,
    key: string,
    accessCode: string | undefined,
    ip: string,
    now = new Date(),
  ): Promise<ParticipationSummaryResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    const view = ContestAccess.accessView(contest);
    const phase = contestPhase(contest, now);
    const onlySpectates =
      ContestAccess.isEditor(principal, view) ||
      ContestAccess.isTester(principal, view);
    if (phase === 'upcoming' && !onlySpectates)
      throw conflict('The contest has not started.');
    this.assertNotBanned(principal, contest);
    let participation: ParticipationDocument;
    if (phase === 'ended') {
      if (contest.disallowVirtual)
        throw conflict('Virtual joining is not allowed for this contest.');
      await this.assertAccessCode(principal, contest, accessCode, ip);
      participation = await this.participationRows.createVirtual(
        contest._id,
        principal.userId,
        now,
      );
    } else {
      const virtual = onlySpectates ? SPECTATE : LIVE;
      const existing = await this.participationRows.findOne(
        contest._id,
        principal.userId,
        virtual,
      );
      if (!existing) {
        if (
          requiresRegistration(contest) &&
          !isRegistrationOpen(contest, now) &&
          !onlySpectates
        )
          throw conflict('You are not registered for this contest.');
        await this.assertAccessCode(principal, contest, accessCode, ip);
        participation = await this.participationRows.findOrCreate(
          contest._id,
          principal.userId,
          virtual,
          now,
        );
      } else {
        participation = existing.isRegistered
          ? await this.participationRows.start(existing, now)
          : existing;
        if (hasParticipationEnded(contest, participation, now))
          participation = await this.participationRows.findOrCreate(
            contest._id,
            principal.userId,
            SPECTATE,
            now,
          );
      }
    }
    await this.participationRows.setCurrent(
      principal.userId,
      participation._id,
    );
    await this.refreshCounts(contest._id);
    return ParticipationSummaryResponse.from(participation, contest);
  }

  /** Legacy `set_disqualified`, with an explicit value instead of a toggle: rescored at -9999 (or back) by the worker, banned from (or allowed back into) the contest and moved out of it, then the cheating ban. */
  async disqualify(
    principal: Principal,
    key: string,
    participationId: string,
    disqualified: boolean,
  ): Promise<ParticipationSummaryResponse> {
    const contest = await this.contestsService.visibleContest(principal, key);
    if (!ContestAccess.canEdit(principal, ContestAccess.accessView(contest)))
      throw forbidden('You cannot edit this contest.');
    const participation =
      await this.participationRows.findById(participationId);
    if (!participation || uuidStr(participation.contest) !== contest._id)
      throw new AppError('not_found', 404, 'No such participation');
    const userId = uuidStr(participation.user);
    const updated = await this.participationRows.setDisqualified(
      participation._id,
      disqualified,
    );
    await this.contests.setBanned(contest._id, userId, disqualified);
    if (disqualified)
      await this.participationRows.clearCurrent(userId, participation._id);
    await purgeRankingCache(this.redis, contest._id);
    void notifyContestRescore(this.rescores, contest._id, this.logger);
    if (!contest.isOrganizationPrivate) await this.checkCheatingBan(userId);
    return ParticipationSummaryResponse.from(updated, contest);
  }

  /** Legacy `check_ban`, off unless `CONTEST_BAN_AFTER_DISQUALIFICATIONS` is set: at the threshold the account is banned (and unlisted, and signed out: `isActive` is what the session guard checks); below it, only this ban is lifted. */
  private async checkCheatingBan(userId: string): Promise<void> {
    const limit = this.env.contestBanAfterDisqualifications;
    if (!limit) return;
    const [count, user] = await Promise.all([
      this.participationRows.countOpenDisqualifications(userId),
      this.users.findById(userId),
    ]);
    if (!user) return;
    if (count >= limit && user.banReason === null)
      await this.users.update(userId, {
        banReason: CONTEST_CHEATING_BAN_REASON,
        displayRank: 'banned',
        isUnlisted: true,
        isActive: false,
      });
    else if (count < limit && user.banReason === CONTEST_CHEATING_BAN_REASON)
      await this.users.update(userId, {
        banReason: null,
        displayRank: 'user',
        isUnlisted: false,
        isActive: true,
      });
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
      throw new AppError('not_found', 404, `You are not in contest "${key}"`);
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
    const filter: FilterQuery<ContestParticipation> = {
      contest: contest._id,
      virtual: { $gte: LIVE },
    };
    if (query.user !== undefined && query.user !== principal.username) {
      if (!canEdit)
        throw forbidden('You can only see your own participations.');
      const user = await this.users.findByUsername(query.user);
      if (!user)
        return new Paginated([], {
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
        });
      filter.user = user._id;
    } else if (!canEdit || query.user !== undefined)
      filter.user = principal.userId;
    const { items, total } = await this.participationRows.list(
      filter,
      query.page,
      query.pageSize,
    );
    const usernames = await this.participationRows.usernamesOf(
      items.map((item) => uuidStr(item.user)),
    );
    const frozen = isFrozen(contest, now) && !canEdit;
    return new Paginated(
      items.map((item) => {
        const userId = uuidStr(item.user);
        return ParticipationResponse.withUser(
          item,
          contest,
          { id: userId, username: usernames.get(userId) ?? '' },
          frozen,
        );
      }),
      { page: query.page, pageSize: query.pageSize, total },
    );
  }

  private assertNotBanned(
    principal: Principal,
    contest: ContestDocument,
  ): void {
    if (
      !principal.isSuperuser &&
      contest.bannedUsers.map(uuidStr).includes(principal.userId)
    )
      throw forbidden('You are banned from joining this contest.');
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
    if (accessCode === undefined)
      throw forbidden('This contest needs an access code.');
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
      throw forbidden('Wrong access code.');
    await Promise.all([releaseUser(), releaseIp()]);
  }

  private async refreshCounts(contestId: string): Promise<void> {
    await this.contests.setCounts(
      contestId,
      await this.participationRows.countsOf(contestId),
    );
  }
}
