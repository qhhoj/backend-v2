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
  scoringKeyOf,
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
import { shiftedWindow } from './contest-clone-window';
import { assertWindow, withUngrantedGatesReset } from './contest-edit-rules';
import {
  chargedOrganization,
  newlyChargedOrganization,
} from '../../organizations/quota/quota-charge';
import { QuotaService } from '../../organizations/quota/quota.service';

/** `GET /contests/current` shadows a contest with this key. */
export const RESERVED_CONTEST_KEYS: readonly string[] = ['current'];

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

/** Matches the contest only while its organization fields are still `contest`'s; an empty list also matches a legacy row without the field. */
function unchangedOrganizations(contest: Contest): FilterQuery<Contest> {
  return {
    ...(contest.organizations.length
      ? { organizations: contest.organizations }
      : { 'organizations.0': { $exists: false } }),
    isOrganizationPrivate: contest.isOrganizationPrivate ? true : { $ne: true },
  };
}

/** The flags the visibility gate (`assertGates`) reads. */
const VISIBILITY_FLAGS = [
  'isVisible',
  'isPrivate',
  'isOrganizationPrivate',
] as const;

/** Matches a stored flag equal to `value`; false also matches a legacy row without the field. */
const flagIs = (value: boolean) => (value ? true : { $ne: true });

/**
 * Stored flags the save must still find, so two concurrent edits can neither both charge (a charged edit saves only
 * while the contest is still unscoped) nor combine into a publish the gate refused each alone (an edit of a
 * visibility flag saves only while all three are as the gate read them, e.g. `isVisible` on a private contest and
 * `isPrivate: false` on a hidden one). The loser gets a 409 and its charge is refunded.
 */
function pinnedFlags(
  contest: Contest,
  fields: Partial<Contest>,
  isCharged: boolean,
): FilterQuery<Contest> {
  const pinned = VISIBILITY_FLAGS.some((flag) => fields[flag] !== undefined)
    ? VISIBILITY_FLAGS
    : isCharged
      ? ['isOrganizationPrivate' as const]
      : [];
  return Object.fromEntries(
    pinned.map((flag) => [flag, flagIs(contest[flag])]),
  );
}

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

  /** Legacy `ContestClone`: settings and problems are copied, the cloner is the only author, and per-contest collections stay with the source. A `startTime` moves the copy's whole window there. The copy starts hidden and unrated, a gated setting the cloner may not set is reset (`withUngrantedGatesReset`), and its window passes the create rules (`assertWindow`). */
  async clone(
    principal: Principal,
    key: string,
    newKey: string,
    startTime?: string,
  ): Promise<ContestDetailResponse> {
    const source = await this.contestsService.editableContest(principal, key);
    if (RESERVED_CONTEST_KEYS.includes(newKey))
      throw invalidField('key', 'This key is reserved.', 'key_reserved');
    const { _id, createdAt, updatedAt, ...settings } =
      source.toObject() as Contest & {
        createdAt?: Date;
        updatedAt?: Date;
      };
    void [_id, createdAt, updatedAt];
    const copied = withUngrantedGatesReset(principal, {
      ...settings,
      ...(startTime && shiftedWindow(settings, new Date(startTime))),
    }) as Contest;
    assertWindow(principal, copied);
    const ids = (values: readonly string[]) => values.map(uuidStr);
    await this.editFields.assertOrganizationRights(
      principal,
      {
        organizations: ids(copied.organizations),
        isOrganizationPrivate: copied.isOrganizationPrivate,
      },
      null,
    );
    const contest = await this.insert(principal, {
      ...copied,
      key: newKey,
      isVisible: false,
      isRated: false,
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
    // The organization rights were checked against these stored values, so the save holds only while they are unchanged.
    const touchesOrganizations =
      fields.organizations !== undefined ||
      fields.isOrganizationPrivate !== undefined;
    const guard = touchesOrganizations ? unchangedOrganizations(contest) : {};
    await this.applyFields(principal, contest, fields, guard);
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
    const saveGuard = {
      ...pinnedFlags(contest, fields, charged !== null),
      ...guard,
    };
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
    if (scoringKeyOf(updated) !== scoringKeyOf(contest))
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

  /** Legacy admin "judge final submissions" for an FSO contest that has started: like the old admin (which only warned), a running contest may be judged early, and what is submitted later waits for the end. */
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
    if (contestPhase(contest, now) === 'upcoming')
      throw new AppError('conflict', 409, 'The contest has not started');
    await requestFinalJudge(this.finalJudges, contest._id);
    return { queued: true };
  }
}
