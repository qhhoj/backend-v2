import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import { UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, REDIS } from '@libs/common';
import {
  CONTEST_RESCORE_QUEUE,
  contestPhase,
  enqueueContestRescore,
  purgeRankingCache,
} from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import { RevisionsRepository } from '../../problems/core/revisions.repository';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsRepository } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import { ParticipationSummaryResponse } from '../core/dto/contest-detail.response';
import type { QueuedResponse } from '../core/dto/queued.response';
import { ParticipationsRepository } from '../core/participations.repository';
import type { ParticipationDocument } from '../core/participations.repository';
import type {
  AddParticipationDto,
  UpdateParticipationDto,
} from './dto/participation-admin.dto';
import { ParticipationAdminRepository } from './participation-admin.repository';

/** One editor write, for its follow-ups. */
interface ParticipationWrite {
  contest: ContestDocument;
  participation: ParticipationDocument;
  principal: Principal;
  action: 'add' | 'change' | 'delete';
  changes?: Record<string, { before: unknown; after: unknown }>;
}

const notFound = () => new AppError('not_found', 404, 'No such participation');

/** Legacy `ContestParticipationAdmin` add, change, delete and `recalculate_results`, for contest editors. Each write is recorded as a `contestParticipation` revision. */
@Injectable()
export class ParticipationAdminService {
  constructor(
    private readonly contestsService: ContestsService,
    private readonly contests: ContestsRepository,
    private readonly participationRows: ParticipationsRepository,
    private readonly adminRows: ParticipationAdminRepository,
    private readonly users: UsersRepository,
    private readonly revisions: RevisionsRepository,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** A live row (409 `already_participating` when one exists) or the user's next virtual run; the user's current contest is left alone. */
  async add(
    principal: Principal,
    key: string,
    dto: AddParticipationDto,
    now = new Date(),
  ): Promise<ParticipationSummaryResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const user = await this.users.findByUsername(dto.user, { _id: 1 });
    if (!user) throw invalidField('user', 'Unknown user.', 'user_unknown');
    const userId = uuidStr(user._id);
    if (contest.bannedUsers.map(uuidStr).includes(userId))
      throw new AppError(
        'banned_from_contest',
        409,
        'The user is banned from this contest; reinstate them first',
      );
    const created = await this.createRow(contest, userId, dto, now);
    if (!created)
      throw new AppError(
        'already_participating',
        409,
        'The user already has a live participation',
      );
    await this.afterChange({
      contest,
      participation: created,
      principal,
      action: 'add',
    });
    return ParticipationSummaryResponse.from(created, contest);
  }

  /** Moves the start (a timed participant's window); the participation is recomputed by the worker. */
  async update(
    principal: Principal,
    key: string,
    id: string,
    dto: UpdateParticipationDto,
  ): Promise<ParticipationSummaryResponse> {
    const { contest, participation } = await this.target(principal, key, id);
    const updated = await this.adminRows.setRealStart(
      participation._id,
      new Date(dto.realStart),
    );
    if (!updated) throw notFound();
    await this.afterChange({
      contest,
      participation: updated,
      principal,
      action: 'change',
      changes: {
        realStart: {
          before: participation.realStart,
          after: updated.realStart,
        },
      },
    });
    await enqueueContestRescore(this.rescores, contest._id, {
      participationId: updated._id,
    });
    return ParticipationSummaryResponse.from(updated, contest);
  }

  /** Only a participation without submissions (a stray row): results that ranked are kept. */
  async remove(principal: Principal, key: string, id: string): Promise<void> {
    const { contest, participation } = await this.target(principal, key, id);
    if (await this.adminRows.hasSubmissions(participation._id))
      throw new AppError(
        'participation_has_submissions',
        409,
        'A participation with submissions cannot be deleted; disqualify it instead',
      );
    if (!(await this.adminRows.delete(participation._id))) throw notFound();
    await this.participationRows.clearCurrent(
      uuidStr(participation.user),
      participation._id,
    );
    await this.afterChange({
      contest,
      participation,
      principal,
      action: 'delete',
    });
  }

  /** Legacy `recalculate_results` for one participation. */
  async recompute(
    principal: Principal,
    key: string,
    id: string,
  ): Promise<QueuedResponse> {
    const { contest, participation } = await this.target(principal, key, id);
    await enqueueContestRescore(this.rescores, contest._id, {
      participationId: participation._id,
    });
    return { queued: true };
  }

  /** Null when a live row exists already. */
  private createRow(
    contest: ContestDocument,
    userId: string,
    dto: AddParticipationDto,
    now: Date,
  ): Promise<ParticipationDocument | null> {
    const realStart = dto.realStart
      ? new Date(dto.realStart)
      : defaultStart(contest, dto.kind, now);
    return dto.kind === 'live'
      ? this.participationRows.insertLive(contest._id, userId, { realStart })
      : this.participationRows.createVirtual(
          contest._id,
          userId,
          realStart,
          null,
        );
  }

  private async target(
    principal: Principal,
    key: string,
    id: string,
  ): Promise<{
    contest: ContestDocument;
    participation: ParticipationDocument;
  }> {
    const contest = await this.contestsService.editableContest(principal, key);
    const participation = await this.participationRows.findById(id);
    if (!participation || uuidStr(participation.contest) !== contest._id)
      throw notFound();
    return { contest, participation };
  }

  /** The cached board and the audit trail follow every write; counts follow an add or a delete. */
  private async afterChange({
    contest,
    participation,
    principal,
    action,
    changes = {},
  }: ParticipationWrite): Promise<void> {
    if (action !== 'change')
      await this.contests.setCounts(
        contest._id,
        await this.participationRows.countsOf(contest._id),
      );
    await purgeRankingCache(this.redis, contest._id);
    await this.revisions.append({
      entity: 'contestParticipation',
      entityId: uuidStr(participation._id),
      action,
      userId: principal.userId,
      changes,
      comment: `${contest.key}: user ${uuidStr(participation.user)}, virtual ${participation.virtual}`,
    });
  }
}

/** Now while the contest runs; otherwise the contest start for a live row and now for a virtual run. */
function defaultStart(
  contest: ContestDocument,
  kind: AddParticipationDto['kind'],
  now: Date,
): Date {
  if (contestPhase(contest, now) === 'running' || kind === 'virtual')
    return now;
  return contest.startTime;
}
