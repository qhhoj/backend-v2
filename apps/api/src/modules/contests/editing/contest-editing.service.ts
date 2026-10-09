import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, REDIS, sameJson, unique } from '@libs/common';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_RESCORE_QUEUE,
  contestPhase,
  enqueueContestRescore,
  notifyContestRescore,
  purgeRankingCache,
  requestFinalJudge,
  rescheduleFinalJudge,
} from '@libs/contests';
import type {
  ContestFinalJudgeJob,
  ContestRescoreJob,
  FinalJudgeTarget,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import { ContestsRepository } from '../core/contests.repository';
import type { ContestDocument } from '../core/contests.repository';
import { ContestsService } from '../core/contests.service';
import type { ContestDetailResponse } from '../core/dto/contest-detail.response';
import type { QueuedResponse } from '../core/dto/queued.response';
import type {
  CreateContestDto,
  UpdateContestDto,
} from './dto/contest-edit.dto';
import { ContestEditFieldsService } from './contest-edit-fields.service';

/** `GET /contests/current` shadows a contest with this key. */
export const RESERVED_CONTEST_KEYS: readonly string[] = ['current'];

/** What every participation's results depend on (legacy admin rescored on these and on the problem inlines); the times move the freeze window. */
const scoringOf = (contest: Contest) =>
  JSON.stringify([
    contest.formatName,
    contest.formatConfig,
    contest.startTime,
    contest.endTime,
    contest.frozenLastMinutes,
    contest.pointsPrecision,
    contest.problems.map((entry) => [
      uuidStr(entry.problem),
      entry.points,
      entry.partial,
      entry.order,
    ]),
  ]);

const finalJudgeTarget = (contest: Contest): FinalJudgeTarget => ({
  id: uuidStr(contest._id),
  endTime: contest.endTime,
  formatName: contest.formatName,
  formatConfig: contest.formatConfig,
});

@Injectable()
export class ContestEditingService {
  private readonly logger = new Logger(ContestEditingService.name);

  constructor(
    private readonly contests: ContestsRepository,
    private readonly contestsService: ContestsService,
    private readonly editFields: ContestEditFieldsService,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE)
    private readonly finalJudges: Queue<ContestFinalJudgeJob>,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Legacy `CreateContest`: the creator becomes an author. */
  async create(
    principal: Principal,
    dto: CreateContestDto,
  ): Promise<ContestDetailResponse> {
    if (RESERVED_CONTEST_KEYS.includes(dto.key))
      throw invalidField('key', 'This key is reserved.', 'key_reserved');
    const contest = await this.insert(principal, {
      ...(await this.editFields.toFields(principal, dto, null)),
      key: dto.key,
    });
    return this.contestsService.detail(principal, contest.key);
  }

  /** Legacy `ContestClone`: settings and problems are copied, the cloner is the only author, and per-contest collections stay with the source. */
  async clone(
    principal: Principal,
    key: string,
    newKey: string,
  ): Promise<ContestDetailResponse> {
    const source = await this.contestsService.editableContest(principal, key);
    if (RESERVED_CONTEST_KEYS.includes(newKey))
      throw invalidField('key', 'This key is reserved.', 'key_reserved');
    const { _id, createdAt, updatedAt, ...copied } =
      source.toObject() as Contest & {
        createdAt?: Date;
        updatedAt?: Date;
      };
    void [_id, createdAt, updatedAt];
    const ids = (values: readonly string[]) => values.map(uuidStr);
    const contest = await this.insert(principal, {
      ...copied,
      key: newKey,
      isVisible: false,
      userCount: 0,
      virtualCount: 0,
      lockedAfter: null,
      dataPreparedAt: null,
      managedBy: null,
      balloonStaff: [],
      exportPreparedAt: null,
      organizations: ids(copied.organizations),
      privateContestants: ids(copied.privateContestants),
      viewContestScoreboard: ids(copied.viewContestScoreboard),
      authors: [],
      curators: [],
      testers: [],
      bannedUsers: [],
      bannedJudges: [],
      rateExclude: [],
      problems: copied.problems.map((entry) => ({
        ...entry,
        problem: uuidStr(entry.problem),
      })),
    });
    return this.contestsService.detail(principal, contest.key);
  }

  /** The caller becomes an author; FSO judging is scheduled for the new end. */
  private async insert(
    principal: Principal,
    fields: Partial<Contest>,
  ): Promise<ContestDocument> {
    const contest = await this.contests.create({
      ...fields,
      authors: unique([...(fields.authors ?? []), principal.userId]),
    });
    await rescheduleFinalJudge(
      this.finalJudges,
      { previous: null, next: finalJudgeTarget(contest) },
      this.logger,
    );
    return contest;
  }

  /** Scoring edits queue a rescore; a new lock is copied onto live submissions. */
  async update(
    principal: Principal,
    key: string,
    dto: UpdateContestDto,
  ): Promise<ContestDetailResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const fields = await this.editFields.toFields(principal, dto, contest);
    if (
      contest.formatName === 'final_submission' &&
      fields.formatName &&
      fields.formatName !== contest.formatName &&
      (await this.contests.hasPendingSubmissions(contest._id))
    )
      throw new AppError(
        'conflict',
        409,
        'Judge the pending submissions before leaving final_submission',
      );
    const updated = await this.save(contest, fields);
    // Cached boards embed the contest's problems, labels and timeout, not only standings.
    await purgeRankingCache(this.redis, contest._id);
    await rescheduleFinalJudge(
      this.finalJudges,
      { previous: finalJudgeTarget(contest), next: finalJudgeTarget(updated) },
      this.logger,
    );
    // `endTime` is part of the scoring: the rescore's follow-up re-rates a contest that has ratings.
    if (scoringOf(updated) !== scoringOf(contest))
      void notifyContestRescore(this.rescores, contest._id, this.logger);
    if (
      fields.lockedAfter !== undefined &&
      !sameJson(fields.lockedAfter, contest.lockedAfter)
    )
      await this.contests.propagateLock(contest._id, fields.lockedAfter);
    return this.contestsService.detail(principal, key);
  }

  /** Changed rules raise the revision inside the same update; a concurrent change of the rules is a conflict. */
  private async save(
    contest: ContestDocument,
    fields: Partial<Contest>,
  ): Promise<ContestDocument> {
    if (fields.rules === undefined || fields.rules === contest.rules)
      return this.contests.update(contest._id, fields);
    const updated = await this.contests.updateRules(
      contest._id,
      contest.rules,
      fields,
    );
    if (!updated)
      throw new AppError(
        'conflict',
        409,
        'The contest rules changed meanwhile; reload and save again',
      );
    return updated;
  }

  /** An editor's manual rescore (legacy admin action). */
  async rescore(principal: Principal, key: string): Promise<QueuedResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    await enqueueContestRescore(this.rescores, contest._id);
    return { queued: true };
  }

  /** Legacy admin "judge final submissions": an ended FSO contest only (judging pending rows of a running one would end the format's point). */
  async judgeFinal(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<QueuedResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    if (contest.formatName !== 'final_submission')
      throw new AppError(
        'conflict',
        409,
        'Only final-submission contests are judged at the end',
      );
    if (contestPhase(contest, now) !== 'ended')
      throw new AppError('conflict', 409, 'The contest has not ended');
    await requestFinalJudge(this.finalJudges, contest._id);
    return { queued: true };
  }
}
