import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, PipelineStage } from 'mongoose';
import { isDuplicateKey } from '@libs/common';
import {
  JUDGING_CHARGE_STATUSES,
  OrganizationJudgingCharge,
  Problem,
  Submission,
  toUuid,
  uuidStr,
} from '@libs/database';
import type { JudgingChargeStatus, SubmissionStatus } from '@libs/database';
import { EXTERNAL_JUDGE_NAME } from '@libs/judging';
import { SettingsService } from '@libs/settings';
import { ownerOrganization } from './charged-organization';
import { quotaMonthOf } from './quota-month';
import type { UsageKey } from './quota.types';

/** A run whose grading began longer ago than this before its graded job is not charged: only an api action (score override, reject) re-sends such a job, for a run judged long ago, possibly before the meter existed. A worker outage longer than this loses charges (an under-charge, never a double charge). */
export const STALE_RUN_MS = 7 * 24 * 60 * 60 * 1000;

/** What a finished grading attempt left on its submission row. */
interface FinishedRun {
  status: SubmissionStatus;
  result: string | null;
  judgeGeneration: number;
  judgedOn: string | null;
  /** Grading-begin; null for a run that ended before it. */
  judgedDate: Date | null;
  user: unknown;
  /** Solution plus jury CPU seconds over the stored cases. */
  seconds: number;
}

/** One grading run, as the graded job names it. */
export interface GradedRun {
  submissionId: string;
  problemId: string;
}

/** The sum is taken server side: `cases` is `select: false` and can hold 10000 rows. A case stored before `juryTime` existed has none. */
const finishedRunPipeline = (submissionId: string): PipelineStage[] => [
  { $match: { _id: toUuid(submissionId) } },
  {
    $project: {
      status: 1,
      result: 1,
      judgeGeneration: { $ifNull: ['$judgeGeneration', 0] },
      judgedOn: 1,
      judgedDate: 1,
      user: 1,
      seconds: {
        $sum: {
          $map: {
            input: { $ifNull: ['$cases', []] },
            in: {
              $add: [
                { $ifNull: ['$$this.time', 0] },
                { $ifNull: ['$$this.juryTime', 0] },
              ],
            },
          },
        },
      },
    },
  },
];

/** A recent run of our judges that ended (graded, internal error, abort); compile errors store no cases, so they come to 0. */
const isChargeable = (run: FinishedRun, now: Date): boolean =>
  (JUDGING_CHARGE_STATUSES as readonly string[]).includes(run.status) &&
  run.result !== 'RJ' &&
  run.judgedOn !== EXTERNAL_JUDGE_NAME &&
  !(run.judgedDate && now.getTime() - run.judgedDate.getTime() > STALE_RUN_MS);

/** Writes the judging-time charges of organization problems: one row per (submission, judge generation), so a redelivered graded job, a sweep repair or a retry is charged once. Measure only: it never refuses anything. */
@Injectable()
export class JudgingCharges {
  constructor(
    private readonly settings: SettingsService,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(OrganizationJudgingCharge.name)
    private readonly charges: Model<OrganizationJudgingCharge>,
  ) {}

  /** Charges the run's CPU time to the problem's owner in `now`'s month. Null when nothing new was charged: a site or missing problem, a run that is not finished, not ours or stale (`STALE_RUN_MS`), 0 ms, or an attempt already charged. A database error is thrown so the graded job is retried. */
  async chargeRun(run: GradedRun, now = new Date()): Promise<UsageKey | null> {
    const organizationId = await this.ownerOf(run.problemId);
    if (!organizationId) return null;
    const [finished] = await this.submissions.aggregate<FinishedRun>(
      finishedRunPipeline(run.submissionId),
    );
    if (!finished || !isChargeable(finished, now)) return null;
    const ms = Math.round(finished.seconds * 1000);
    if (ms <= 0) return null;
    const key = {
      organizationId,
      month: quotaMonthOf(this.settings, now),
    };
    const inserted = await this.insertOnce(key, run, finished, ms);
    return inserted ? key : null;
  }

  private async ownerOf(problemId: string): Promise<string | null> {
    const problem = await this.problems
      .findById(problemId, { isOrganizationPrivate: 1, organizations: 1 })
      .lean()
      .exec();
    if (!problem) return null;
    return ownerOrganization({
      isOrganizationPrivate: problem.isOrganizationPrivate,
      organizations: (problem.organizations ?? []).map(uuidStr),
    });
  }

  /** False when this attempt already has its row (the unique index). */
  private async insertOnce(
    key: UsageKey,
    run: GradedRun,
    finished: FinishedRun,
    ms: number,
  ): Promise<boolean> {
    try {
      await this.charges.create({
        organization: key.organizationId,
        month: key.month,
        submission: run.submissionId,
        generation: finished.judgeGeneration,
        problem: run.problemId,
        user: uuidStr(finished.user),
        status: finished.status as JudgingChargeStatus,
        ms,
      });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }
}
