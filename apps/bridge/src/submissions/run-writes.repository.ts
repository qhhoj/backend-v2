import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model, UpdateQuery } from 'mongoose';
import {
  IN_FLIGHT_STATUSES,
  Problem,
  Submission,
  toUuid,
} from '@libs/database';
import type { SubmissionCase, SubmissionStatus } from '@libs/database';
import {
  effectsDue,
  gradeCases,
  gradedJobOf,
  submissionPoints,
} from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import { MAX_SUBMISSION_CASES } from '../link/link-limits';
import { REQUEUE_RESET } from './submissions.repository';
import { classifyMiss } from './write-outcome';
import type { RunKey, StoredRun, WriteOutcome } from './write-outcome';

/** `Final{RETRY}` answers a submission may get; the last one is IE. */
export const MAX_RETRIES = 3;
export const RETRY_LIMIT_MESSAGE = 'The judge could not run this submission';

/** A write that may end the run: when applied, the graded job of the finished submission. */
export interface FinishOutcome {
  outcome: WriteOutcome;
  job: SubmissionGradedJob | null;
}

/** A RETRY that was applied either requeued the row or (at the cap) finished it as IE. */
export interface RetryOutcome extends FinishOutcome {
  requeued: boolean;
}

const IN_FLIGHT = [...IN_FLIGHT_STATUSES];
/** A GRADED Final may follow Accepted directly (conformance 37): a run with no cases is graded as it stands. */
const GRADABLE: readonly SubmissionStatus[] = ['P', 'G'];
const GRADED_JOB_FIELDS = { user: 1, problem: 1 } as const;

/** The run's row, its judge and generation, and the previous seq: exactly-once effect for at-least-once delivery. */
const runFilter = (key: RunKey, statuses: readonly SubmissionStatus[]) => ({
  _id: key.ref.submissionId,
  judgedOn: key.judgeName,
  judgeGeneration: key.ref.generation,
  judgeSeq: key.seq - 1,
  status: { $in: [...statuses] },
});

/** Every write a judge message causes: one `updateOne` that also advances `judgeSeq`, so a replay, a gap or another run's message changes nothing; a miss is classified by one read. */
@Injectable()
export class RunWritesRepository {
  private readonly logger = new Logger(RunWritesRepository.name);

  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
  ) {}

  /** Accepted is seq 1: the row stays P and only `judgeSeq` moves. */
  accept(key: RunKey): Promise<WriteOutcome> {
    return this.write(key, ['P'], {});
  }

  /** Compiler warnings, kept as the submission's `error`. */
  compiled(key: RunKey, log: string): Promise<WriteOutcome> {
    return this.write(key, IN_FLIGHT, { error: log });
  }

  started(key: RunKey, isPretested: boolean): Promise<WriteOutcome> {
    return this.write(key, ['P'], {
      status: 'G',
      isPretested,
      currentTestcase: 1,
      batch: false,
      judgedDate: new Date(),
      cases: [],
    });
  }

  /** `$push` only while fewer than `MAX_SUBMISSION_CASES - cases.length` are stored; the first case of a batch marks the submission batched. */
  async cases(key: RunKey, cases: SubmissionCase[]): Promise<WriteOutcome> {
    if (!cases.length) return this.write(key, ['G'], {});
    const { matchedCount } = await this.submissions.updateOne(
      {
        ...runFilter(key, ['G']),
        [`cases.${MAX_SUBMISSION_CASES - cases.length}`]: { $exists: false },
      },
      {
        $push: { cases: { $each: cases } },
        $set: {
          judgeSeq: key.seq,
          currentTestcase: Math.max(...cases.map((row) => row.position)) + 1,
          ...(cases.some((row) => row.batch !== null) && { batch: true }),
        },
      },
    );
    return matchedCount === 1 ? 'applied' : this.miss(key, ['G'], cases.length);
  }

  /** Legacy `on_grading_end`, also from P: totals from the stored cases, points from the problem's current points. */
  async finishGraded(
    key: RunKey,
    dataVersionUsed: number,
  ): Promise<FinishOutcome> {
    const filter = runFilter(key, GRADABLE);
    const submission = await this.submissions
      .findOne(filter, { user: 1, problem: 1, cases: 1 })
      .lean();
    if (!submission)
      return { outcome: await this.miss(key, GRADABLE), job: null };
    const problem = await this.problems
      .findById(submission.problem, { points: 1, partial: 1 })
      .lean();
    if (!problem)
      this.logger.warn(
        `Submission ${key.ref.submissionId} graded with 0 points: its problem is gone, rescore it once restored`,
      );
    const totals = gradeCases(submission.cases);
    const points = problem
      ? submissionPoints(
          totals.casePoints,
          totals.caseTotal,
          problem.points,
          problem.partial,
        )
      : 0;
    const { modifiedCount } = await this.submissions.updateOne(filter, {
      $set: {
        status: 'D',
        ...totals,
        points,
        judgedDataVersion: dataVersionUsed,
        judgeSeq: key.seq,
        ...effectsDue(),
      },
    });
    return modifiedCount === 1
      ? { outcome: 'applied', job: gradedJobOf(submission) }
      : { outcome: await this.miss(key, GRADABLE), job: null };
  }

  /** Final COMPILE_ERROR (CE + log), INTERNAL_ERROR (IE + message) or ABORTED (AB, no points). */
  async finishWith(
    key: RunKey,
    status: 'CE' | 'IE' | 'AB',
    { log, dataVersionUsed }: { log: string; dataVersionUsed: number },
  ): Promise<FinishOutcome> {
    const fields =
      status === 'AB'
        ? { status, result: status, points: 0 }
        : { status, result: status, error: log };
    return this.finish(key, {
      $set: {
        ...fields,
        judgedDataVersion: dataVersionUsed,
        judgeSeq: key.seq,
        ...effectsDue(),
      },
    });
  }

  /** Final RETRY: back to QU without spending `requeueCount` (the judge could not run it), until the third RETRY, which is IE. */
  async retry(key: RunKey, log: string): Promise<RetryOutcome> {
    const row = await this.submissions
      .findOneAndUpdate(
        {
          ...runFilter(key, IN_FLIGHT),
          retryCount: { $not: { $gte: MAX_RETRIES - 1 } },
        },
        // the run's seq stays, so a replay of this Final is classified a duplicate (the next claim resets it)
        {
          // the judge cannot run it: a pin to that judge would bring it back there
          $set: { ...REQUEUE_RESET, judgeSeq: key.seq, pinnedJudge: null },
          $inc: { retryCount: 1 },
        },
        { projection: GRADED_JOB_FIELDS },
      )
      .lean();
    if (row)
      return { outcome: 'applied', job: gradedJobOf(row), requeued: true };
    const failed = await this.finish(key, {
      $set: {
        status: 'IE',
        result: 'IE',
        error: `${RETRY_LIMIT_MESSAGE}: ${log}`,
        judgeSeq: key.seq,
        ...effectsDue(),
      },
      $inc: { retryCount: 1 },
    });
    return { ...failed, requeued: false };
  }

  private async finish(
    key: RunKey,
    update: UpdateQuery<Submission>,
  ): Promise<FinishOutcome> {
    const row = await this.submissions
      .findOneAndUpdate(runFilter(key, IN_FLIGHT), update, {
        projection: GRADED_JOB_FIELDS,
      })
      .lean();
    return row
      ? { outcome: 'applied', job: gradedJobOf(row) }
      : { outcome: await this.miss(key, IN_FLIGHT), job: null };
  }

  private async write(
    key: RunKey,
    statuses: readonly SubmissionStatus[],
    fields: Partial<Submission>,
  ): Promise<WriteOutcome> {
    const { matchedCount } = await this.submissions.updateOne(
      runFilter(key, statuses),
      {
        $set: { ...fields, judgeSeq: key.seq },
      },
    );
    return matchedCount === 1 ? 'applied' : this.miss(key, statuses);
  }

  private async miss(
    key: RunKey,
    statuses: readonly SubmissionStatus[],
    addsCases = 0,
  ): Promise<WriteOutcome> {
    return classifyMiss(key, await this.storedRun(key.ref.submissionId), {
      statuses,
      addsCases,
    });
  }

  /** One read, `cases` counted on the server: a 10000-case row is never hydrated to classify a miss. */
  private async storedRun(submissionId: string): Promise<StoredRun | null> {
    const [row] = await this.submissions.aggregate<StoredRun>([
      { $match: { _id: toUuid(submissionId) } },
      {
        $project: {
          _id: 0,
          judgedOn: 1,
          judgeGeneration: { $ifNull: ['$judgeGeneration', 0] },
          judgeSeq: { $ifNull: ['$judgeSeq', 0] },
          status: 1,
          caseCount: { $size: { $ifNull: ['$cases', []] } },
          retryCount: { $ifNull: ['$retryCount', 0] },
        },
      },
    ]);
    return row ?? null;
  }
}
