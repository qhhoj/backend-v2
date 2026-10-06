import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import {
  IN_FLIGHT_STATUSES,
  Language,
  Problem,
  Submission,
  SubmissionSource,
  uuidStr,
} from '@libs/database';
import type { SubmissionCase } from '@libs/database';
import { gradeCases, gradedJobOf, submissionPoints } from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import type { QueuedSubmission } from '../dispatch/dispatch';
import { MAX_SUBMISSION_CASES } from '../protocol/judge-packets';
import type { SubmissionRequest } from '../protocol/judge-packets';

/** Judge disconnects forgiven while a submission is in flight; the next one is an internal error. */
export const MAX_REQUEUES = 1;
/** `failed`: the submission's data vanished, so it was finished as IE and still needs its graded job. */
export type ClaimOutcome =
  { request: SubmissionRequest } | { failed: SubmissionGradedJob };
export type CasesOutcome = 'appended' | 'stale' | 'full';

/** Back to the queue with partial results dropped; the `$set` of every requeue and reset-in-flight write. */
export const REQUEUE_RESET = {
  status: 'QU',
  judgedOn: null,
  judgedDate: null,
  cases: [],
  currentTestcase: 0,
  batch: false,
  error: null,
} as const;

const IN_FLIGHT = { $in: [...IN_FLIGHT_STATUSES] };
const unique = (values: string[]): string[] => [...new Set(values)];

/** Every write a judge packet causes filters on the submission's judge and status, so stale, duplicate or replayed packets change nothing. */
@Injectable()
export class SubmissionsRepository {
  private readonly logger = new Logger(SubmissionsRepository.name);

  constructor(
    @InjectModel(Submission.name)
    private readonly submissions: Model<Submission>,
    @InjectModel(SubmissionSource.name)
    private readonly sources: Model<SubmissionSource>,
    @InjectModel(Problem.name) private readonly problems: Model<Problem>,
    @InjectModel(Language.name) private readonly languages: Model<Language>,
  ) {}

  /** Queued submissions (all, or those of `ids`) in dispatch order, with the codes judges know: a mirror is judged under its root's code. A row whose problem or language is gone is skipped. */
  async loadQueued(ids?: string[]): Promise<QueuedSubmission[]> {
    const rows = await this.submissions
      .find(
        { status: 'QU', ...(ids && { _id: { $in: ids } }) },
        { problem: 1, language: 1, priority: 1 },
      )
      .sort({ priority: 1, _id: 1 })
      .lean();
    const problems = await this.problems
      .find(
        { _id: { $in: unique(rows.map((row) => uuidStr(row.problem))) } },
        { code: 1, mirrorRoot: 1 },
      )
      .lean();
    const rootIds = problems.flatMap((problem) =>
      problem.mirrorRoot ? [uuidStr(problem.mirrorRoot)] : [],
    );
    const roots = rootIds.length
      ? await this.problems.find({ _id: { $in: rootIds } }, { code: 1 }).lean()
      : [];
    const codeOf = new Map(
      [...problems, ...roots].map((problem) => [
        uuidStr(problem._id),
        problem.code,
      ]),
    );
    const judgedCodeOf = new Map(
      problems.map((problem) => [
        uuidStr(problem._id),
        codeOf.get(uuidStr(problem.mirrorRoot ?? problem._id)),
      ]),
    );
    const languages = await this.languages
      .find(
        { _id: { $in: unique(rows.map((row) => uuidStr(row.language))) } },
        { key: 1 },
      )
      .lean();
    const keyOf = new Map(
      languages.map((language) => [uuidStr(language._id), language.key]),
    );
    return rows.flatMap((row) => {
      const problemCode = judgedCodeOf.get(uuidStr(row.problem));
      const languageKey = keyOf.get(uuidStr(row.language));
      return problemCode && languageKey
        ? [
            {
              id: uuidStr(row._id),
              problemCode,
              languageKey,
              priority: row.priority,
              judgeName: null,
              bannedJudges: [],
            },
          ]
        : [];
    });
  }

  /** Compare-and-set QU → P for `judgeName`, then what the judge needs. Null when it is no longer queued (aborted, rejudged, claimed by another judge). */
  async claim(
    queued: QueuedSubmission,
    judgeName: string,
  ): Promise<ClaimOutcome | null> {
    const submission = await this.submissions
      .findOneAndUpdate(
        { _id: queued.id, status: 'QU' },
        { $set: { status: 'P', judgedOn: judgeName } },
        {
          new: true,
          projection: { user: 1, problem: 1, language: 1, date: 1 },
        },
      )
      .lean();
    if (!submission) return null;
    const [problem, source, earlierAttempts] = await Promise.all([
      this.problems
        .findById(submission.problem, {
          timeLimit: 1,
          memoryLimit: 1,
          partial: 1,
          languageLimits: 1,
        })
        .lean(),
      this.sources.findById(queued.id).lean(),
      this.submissions.countDocuments({
        user: submission.user,
        problem: submission.problem,
        contest: null,
        date: { $lt: submission.date },
        status: { $nin: ['CE', 'IE'] },
      }),
    ]);
    if (!problem || !source) {
      this.logger.error(`Submission ${queued.id} lost its problem or source`);
      const failed = await this.finishWith(
        queued.id,
        judgeName,
        'IE',
        'Submission data is missing',
      );
      return failed && { failed };
    }
    const languageId = uuidStr(submission.language);
    const limit = problem.languageLimits.find(
      (entry) => uuidStr(entry.languageId) === languageId,
    );
    const request: SubmissionRequest = {
      submissionId: queued.id,
      problemCode: queued.problemCode,
      languageKey: queued.languageKey,
      source: source.source,
      timeLimit: limit?.timeLimit ?? problem.timeLimit,
      memoryLimit: limit?.memoryLimit ?? problem.memoryLimit,
      shortCircuit: !problem.partial,
      pretestsOnly: false,
      inContest: null,
      attemptNo: earlierAttempts + 1,
      userId: uuidStr(submission.user),
      fileOnly: false,
      fileSizeLimit: 0,
    };
    return { request };
  }

  /** The judge vanished between the claim and the request: back to the queue without spending the requeue (the judge never saw it). */
  async release(submissionId: string, judgeName: string): Promise<boolean> {
    const { modifiedCount } = await this.submissions.updateOne(
      { _id: submissionId, judgedOn: judgeName, status: 'P' },
      { $set: { status: 'QU', judgedOn: null } },
    );
    return modifiedCount === 1;
  }

  async beginGrading(
    submissionId: string,
    judgeName: string,
    pretested: boolean,
  ): Promise<boolean> {
    const { modifiedCount } = await this.submissions.updateOne(
      { _id: submissionId, judgedOn: judgeName, status: 'P' },
      {
        $set: {
          status: 'G',
          isPretested: pretested,
          currentTestcase: 1,
          batch: false,
          judgedDate: new Date(),
          cases: [],
        },
      },
    );
    return modifiedCount === 1;
  }

  async markBatched(submissionId: string, judgeName: string): Promise<void> {
    await this.submissions.updateOne(
      { _id: submissionId, judgedOn: judgeName, status: 'G' },
      { $set: { batch: true } },
    );
  }

  /** `$push` only while fewer than `MAX_SUBMISSION_CASES - cases.length` are stored; `full` tells a hostile judge apart from a stale packet. */
  async appendCases(
    submissionId: string,
    judgeName: string,
    cases: SubmissionCase[],
  ): Promise<CasesOutcome> {
    if (!cases.length) return 'stale';
    const grading = { _id: submissionId, judgedOn: judgeName, status: 'G' };
    const { matchedCount } = await this.submissions.updateOne(
      {
        ...grading,
        [`cases.${MAX_SUBMISSION_CASES - cases.length}`]: { $exists: false },
      },
      {
        $push: { cases: { $each: cases } },
        $set: {
          currentTestcase:
            Math.max(...cases.map((testCase) => testCase.position)) + 1,
        },
      },
    );
    if (matchedCount === 1) return 'appended';
    return (await this.submissions.exists(grading)) ? 'full' : 'stale';
  }

  async setCompileMessage(
    submissionId: string,
    judgeName: string,
    log: string,
  ): Promise<void> {
    await this.submissions.updateOne(
      { _id: submissionId, judgedOn: judgeName, status: IN_FLIGHT },
      { $set: { error: log } },
    );
  }

  /** Legacy `on_grading_end`: totals from the stored cases, points from the problem's current points. */
  async finishGrading(
    submissionId: string,
    judgeName: string,
  ): Promise<SubmissionGradedJob | null> {
    const grading = { _id: submissionId, judgedOn: judgeName, status: 'G' };
    const submission = await this.submissions
      .findOne(grading, { user: 1, problem: 1, cases: 1 })
      .lean();
    if (!submission) return null;
    const problem = await this.problems
      .findById(submission.problem, { points: 1, partial: 1 })
      .lean();
    if (!problem)
      this.logger.warn(
        `Submission ${submissionId} graded with 0 points: its problem is gone, rescore it once restored`,
      );
    const totals = gradeCases(submission.cases);
    const { modifiedCount } = await this.submissions.updateOne(grading, {
      $set: {
        status: 'D',
        ...totals,
        points: problem
          ? submissionPoints(
              totals.casePoints,
              totals.caseTotal,
              problem.points,
              problem.partial,
            )
          : 0,
      },
    });
    return modifiedCount === 1 ? gradedJobOf(submission) : null;
  }

  /** compile-error (CE + log), internal-error (IE + message) or submission-terminated (AB, no points). */
  async finishWith(
    submissionId: string,
    judgeName: string,
    status: 'CE' | 'IE' | 'AB',
    error: string | null,
  ): Promise<SubmissionGradedJob | null> {
    const submission = await this.submissions
      .findOneAndUpdate(
        { _id: submissionId, judgedOn: judgeName, status: IN_FLIGHT },
        {
          $set:
            status === 'AB'
              ? { status, result: status, points: 0 }
              : { status, result: status, error },
        },
        { projection: { user: 1, problem: 1 } },
      )
      .lean();
    return submission && gradedJobOf(submission);
  }

  /** First judge loss while in flight: back to QU with partial results dropped and the requeue spent; false once it is spent or the submission is no longer this judge's. */
  async requeue(submissionId: string, judgeName: string): Promise<boolean> {
    const { modifiedCount } = await this.submissions.updateOne(
      {
        _id: submissionId,
        judgedOn: judgeName,
        status: IN_FLIGHT,
        requeueCount: { $not: { $gte: MAX_REQUEUES } },
      },
      {
        $set: REQUEUE_RESET,
        $inc: { requeueCount: 1 },
      },
    );
    return modifiedCount === 1;
  }
}
