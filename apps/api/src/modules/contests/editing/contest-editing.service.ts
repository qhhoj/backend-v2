import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type Redis from 'ioredis';
import type { FilterQuery } from 'mongoose';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, REDIS, sameJson, unique } from '@libs/common';
import {
  CONTEST_FINAL_JUDGE_QUEUE,
  CONTEST_PUBLISH_QUEUE,
  CONTEST_RESCORE_QUEUE,
  contestPhase,
  enqueueContestRescore,
  notifyContestRescore,
  purgeRankingCache,
  requestFinalJudge,
  rescheduleFinalJudge,
  reschedulePublish,
} from '@libs/contests';
import type {
  ContestFinalJudgeJob,
  ContestPublishJob,
  ContestRescoreJob,
  FinalJudgeTarget,
  PublishTarget,
} from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import { ProblemsRepository } from '../../problems/core/problems.repository';
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
import {
  chargedOrganization,
  newlyChargedOrganization,
} from '../../organizations/quota/quota-charge';
import { QuotaService } from '../../organizations/quota/quota.service';

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

const publishTarget = (contest: Contest): PublishTarget => ({
  id: uuidStr(contest._id),
  endTime: contest.endTime,
  publishAfterEnd: contest.publishAfterEnd,
});

@Injectable()
export class ContestEditingService {
  private readonly logger = new Logger(ContestEditingService.name);

  constructor(
    private readonly contests: ContestsRepository,
    private readonly contestsService: ContestsService,
    private readonly editFields: ContestEditFieldsService,
    private readonly problems: ProblemsRepository,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
    @InjectQueue(CONTEST_FINAL_JUDGE_QUEUE)
    private readonly finalJudges: Queue<ContestFinalJudgeJob>,
    @InjectQueue(CONTEST_PUBLISH_QUEUE)
    private readonly publishes: Queue<ContestPublishJob>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly quota: QuotaService,
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
      publishAfterEnd: false,
      publishAfterEndBy: null,
      autoPublishOutcome: null,
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

  /** The caller becomes an author; FSO judging is scheduled for the new end. Shared with the sync API, which validates through `ContestEditFieldsService` itself. An organization-private contest is charged to its first listed organization, refunded when the create fails. */
  async insert(
    principal: Principal,
    fields: Partial<Contest>,
  ): Promise<ContestDocument> {
    const contest = await this.quota.charged(
      chargedOrganization(principal, fields),
      { kind: 'contest', userId: principal.userId, ref: fields.key ?? '' },
      () =>
        this.contests.create({
          ...fields,
          authors: unique([...(fields.authors ?? []), principal.userId]),
        }),
    );
    await this.rescheduleEndJobs({ previous: null, next: contest });
    return contest;
  }

  /** FSO judging and the automatic publish both fire at the end, so one change of end time or switch moves both. */
  private async rescheduleEndJobs(change: {
    previous: Contest | null;
    next: Contest;
  }): Promise<void> {
    const { previous, next } = change;
    await rescheduleFinalJudge(
      this.finalJudges,
      {
        previous: previous && finalJudgeTarget(previous),
        next: finalJudgeTarget(next),
      },
      this.logger,
    );
    await reschedulePublish(
      this.publishes,
      {
        previous: previous && publishTarget(previous),
        next: publishTarget(next),
      },
      this.logger,
    );
  }

  /** Scoring edits queue a rescore; a new lock is copied onto live submissions. */
  async update(
    principal: Principal,
    key: string,
    dto: UpdateContestDto,
  ): Promise<ContestDetailResponse> {
    const contest = await this.contestsService.editableContest(principal, key);
    const fields = await this.editFields.toFields(principal, dto, contest);
    await this.applyFields(principal, contest, fields);
    return this.contestsService.detail(principal, key);
  }

  /** Writes already-validated fields and runs every follow-up of an edit. Shared with the sync API, which validates through `ContestEditFieldsService` itself. An edit that makes a contest organization-scoped (see `newlyChargedOrganization`) is charged to its first listed organization like a create, refunded when the save fails. */
  async applyFields(
    principal: Principal,
    contest: ContestDocument,
    fields: Partial<Contest>,
    guard: FilterQuery<Contest> = {},
  ): Promise<void> {
    await this.assertFormatChangeAllowed(contest, fields);
    const charged = newlyChargedOrganization(principal, contest, fields);
    // A charged edit saves only while the contest is still unscoped, so two concurrent edits cannot both charge: the loser gets a 409 and its charge is refunded.
    const saveGuard =
      charged === null
        ? guard
        : { ...guard, isOrganizationPrivate: contest.isOrganizationPrivate };
    // The re-check runs inside the charged work, so a save it undoes is refunded like any failed save.
    const updated = await this.quota.charged(
      charged,
      { kind: 'contest', userId: principal.userId, ref: contest.key },
      async () => {
        const saved = await this.save(contest, fields, saveGuard);
        await this.undoIfProblemDeleted(contest, fields);
        return saved;
      },
    );
    // Cached boards embed the contest's problems, labels and timeout, not only standings.
    await purgeRankingCache(this.redis, contest._id);
    await this.rescheduleEndJobs({ previous: contest, next: updated });
    // `endTime` is part of the scoring: the rescore's follow-up re-rates a contest that has ratings.
    if (scoringOf(updated) !== scoringOf(contest))
      void notifyContestRescore(this.rescores, contest._id, this.logger);
    if (
      fields.lockedAfter !== undefined &&
      !sameJson(fields.lockedAfter, contest.lockedAfter)
    )
      await this.contests.propagateLock(contest._id, fields.lockedAfter);
  }

  /** The problems were resolved live before the write, but a delete can land between that check and the write (the delete's own re-check covers the other order): check again and put every saved field back, so the edit is refused as if the delete had come first. A save landing between the write and the revert is overwritten (last write wins, as between two editors). */
  private async undoIfProblemDeleted(
    contest: ContestDocument,
    fields: Partial<Contest>,
  ): Promise<void> {
    if (fields.problems === undefined) return;
    const ids = fields.problems.map((entry) => uuidStr(entry.problem));
    if ((await this.problems.findByIds(ids)).length === ids.length) return;
    await this.contests.revert(
      contest,
      Object.keys(fields) as (keyof Contest)[],
    );
    // A board built while the saved problems were live must not outlive the revert.
    await purgeRankingCache(this.redis, contest._id);
    throw invalidField('problems', 'Unknown problem.');
  }

  /** Pending final submissions would never be judged once the contest leaves `final_submission`. */
  private async assertFormatChangeAllowed(
    contest: ContestDocument,
    fields: Partial<Contest>,
  ): Promise<void> {
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
  }

  /** Changed rules raise the revision inside the same update; a concurrent change of the rules, or of the state `guard` names, is a conflict. */
  private async save(
    contest: ContestDocument,
    fields: Partial<Contest>,
    guard: FilterQuery<Contest>,
  ): Promise<ContestDocument> {
    const updated =
      fields.rules === undefined || fields.rules === contest.rules
        ? await this.contests.update(contest._id, fields, guard)
        : await this.contests.updateRules(
            contest._id,
            contest.rules,
            fields,
            guard,
          );
    if (!updated)
      throw new AppError(
        'conflict',
        409,
        'The contest changed meanwhile; reload and save again',
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
