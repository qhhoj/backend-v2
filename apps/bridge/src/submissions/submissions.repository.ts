import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ENV, unique } from '@libs/common';
import type { Env } from '@libs/common';
import { LIVE } from '@libs/contests';
import {
  Contest,
  ContestParticipation,
  ContestSubmission,
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
  | { request: SubmissionRequest; subject: SubmissionGradedJob }
  | { failed: SubmissionGradedJob };
/** A P/G row and the judge it names. */
export interface InFlightClaim {
  id: string;
  judgedOn: string | null;
}
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

/** The claimed row's fields, as `claimIfQueued` projects them. */
type ClaimedSubmission = Pick<
  Submission,
  'user' | 'problem' | 'language' | 'date' | 'contest'
> & { _id: string };

/** What `loadJudgingInputs` reads besides the claimed row. */
interface JudgingInputs {
  problem: Pick<
    Problem,
    'timeLimit' | 'memoryLimit' | 'partial' | 'languageLimits'
  >;
  source: string;
  language: Pick<Language, 'fileOnly' | 'fileSizeLimit'> | null;
  earlierAttempts: number;
  contestMeta: ContestMeta | undefined;
}

/** The judge's request for a claimed submission: limits (a per-language override wins), the source, short-circuiting for non-partial problems, contest meta and the attempt number. Pure. */
function submissionRequest(
  queued: QueuedSubmission,
  submission: ClaimedSubmission,
  { problem, source, language, earlierAttempts, contestMeta }: JudgingInputs,
): SubmissionRequest {
  const languageId = uuidStr(submission.language);
  const limit = problem.languageLimits.find(
    (entry) => uuidStr(entry.languageId) === languageId,
  );
  return {
    submissionId: queued.id,
    problemCode: queued.problemCode,
    languageKey: queued.languageKey,
    source,
    timeLimit: limit?.timeLimit ?? problem.timeLimit,
    memoryLimit: limit?.memoryLimit ?? problem.memoryLimit,
    shortCircuit: !problem.partial,
    pretestsOnly: contestMeta?.pretestsOnly ?? false,
    inContest: contestMeta?.virtual ?? null,
    attemptNo: earlierAttempts + 1,
    userId: uuidStr(submission.user),
    fileOnly: language?.fileOnly ?? false,
    fileSizeLimit: language?.fileSizeLimit ?? 0,
  };
}

const IN_FLIGHT = { $in: [...IN_FLIGHT_STATUSES] };
const ABSOLUTE_URL = /^https?:\/\//i;

/** What a contest submission adds to dispatch and to the judge's request. */
export interface ContestMeta {
  /** The participation's number: 0 live, -1 spectate, n virtual (`in-contest`). */
  virtual: number;
  /** Live and spectating rows only (legacy `judge_submission`). */
  bannedJudges: string[];
  /** The contest's current `runPretestsOnly` and the problem's `isPretested` (legacy recomputed it on every judge, so a rejudge after the contest runs every test). */
  pretestsOnly: boolean;
}

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
    @InjectModel(Contest.name) private readonly contests: Model<Contest>,
    @InjectModel(ContestParticipation.name)
    private readonly participations: Model<ContestParticipation>,
    @InjectModel(ContestSubmission.name)
    private readonly contestSubmissions: Model<ContestSubmission>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Queued submissions (all, or those of `ids`) in dispatch order, with the codes judges know: a mirror is judged under its root's code. A row whose problem or language is gone is skipped. */
  async loadQueued(ids?: string[]): Promise<QueuedSubmission[]> {
    const rows = await this.submissions
      .find(
        { status: 'QU', ...(ids && { _id: { $in: ids } }) },
        { problem: 1, language: 1, priority: 1, contest: 1 },
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
    const metaOf = await this.contestMetaOf(
      rows.filter((row) => row.contest).map((row) => uuidStr(row._id)),
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
              bannedJudges: metaOf.get(uuidStr(row._id))?.bannedJudges ?? [],
            },
          ]
        : [];
    });
  }

  /** Contest meta of the given submissions that are contest submissions; read in three batched queries. */
  private async contestMetaOf(
    submissionIds: string[],
  ): Promise<Map<string, ContestMeta>> {
    if (!submissionIds.length) return new Map();
    const entries = await this.contestSubmissions
      .find(
        { _id: { $in: submissionIds } },
        { participation: 1, contest: 1, problem: 1 },
      )
      .lean();
    if (!entries.length) return new Map();
    const [participations, contests] = await Promise.all([
      this.participations
        .find(
          {
            _id: {
              $in: unique(entries.map((entry) => uuidStr(entry.participation))),
            },
          },
          { virtual: 1 },
        )
        .lean(),
      this.contests
        .find(
          {
            _id: {
              $in: unique(entries.map((entry) => uuidStr(entry.contest))),
            },
          },
          { bannedJudges: 1, runPretestsOnly: 1, problems: 1 },
        )
        .lean(),
    ]);
    const virtualOf = new Map(
      participations.map((participation) => [
        uuidStr(participation._id),
        participation.virtual,
      ]),
    );
    const contestOf = new Map(
      contests.map((contest) => [uuidStr(contest._id), contest]),
    );
    return new Map(
      entries.flatMap((entry): Array<[string, ContestMeta]> => {
        const contest = contestOf.get(uuidStr(entry.contest));
        const virtual = virtualOf.get(uuidStr(entry.participation));
        if (!contest || virtual === undefined) return [];
        const problem = contest.problems.find(
          (candidate) => uuidStr(candidate.problem) === uuidStr(entry.problem),
        );
        return [
          [
            uuidStr(entry._id),
            {
              virtual,
              bannedJudges: virtual <= LIVE ? contest.bannedJudges : [],
              pretestsOnly:
                contest.runPretestsOnly && (problem?.isPretested ?? false),
            },
          ],
        ];
      }),
    );
  }

  /** Earlier attempts at the problem by the same user: within the participation for a contest submission (legacy), else outside contests; CE and IE do not count. */
  private async countEarlierAttempts(submission: {
    _id: string;
    user: string;
    problem: string;
    contest?: string | null;
    date: Date;
  }): Promise<number> {
    const earlier = {
      date: { $lt: submission.date },
      status: { $nin: ['CE', 'IE'] },
    };
    if (!submission.contest)
      return this.submissions.countDocuments({
        user: submission.user,
        problem: submission.problem,
        contest: null,
        ...earlier,
      });
    const entry = await this.contestSubmissions
      .findById(submission._id, { participation: 1 })
      .lean();
    if (!entry) return 0;
    const siblings = await this.contestSubmissions
      .distinct('_id', {
        participation: uuidStr(entry.participation),
        problem: submission.problem,
      })
      .exec();
    return this.submissions.countDocuments({
      _id: { $in: siblings },
      ...earlier,
    });
  }

  /** Compare-and-set QU → P for `judgeName`, then what the judge needs. Null when it is no longer queued (aborted, rejudged, claimed by another judge). */
  async claim(
    queued: QueuedSubmission,
    judgeName: string,
  ): Promise<ClaimOutcome | null> {
    const submission = await this.claimIfQueued(queued.id, judgeName);
    if (!submission) return null;
    const inputs = await this.loadJudgingInputs(queued.id, submission);
    if (!inputs) return this.finishMissingDataAsIE(queued.id, judgeName);
    return {
      request: submissionRequest(queued, submission, inputs),
      subject: gradedJobOf(submission),
    };
  }

  /** Writes P and `judgedOn` on the row, but only while it is still QU. */
  private async claimIfQueued(
    submissionId: string,
    judgeName: string,
  ): Promise<ClaimedSubmission | null> {
    return this.submissions
      .findOneAndUpdate(
        { _id: submissionId, status: 'QU' },
        { $set: { status: 'P', judgedOn: judgeName } },
        {
          new: true,
          projection: { user: 1, problem: 1, language: 1, date: 1, contest: 1 },
        },
      )
      .lean();
  }

  /** The five reads run together, as one `Promise.all`; null when the problem or the source is gone. */
  private async loadJudgingInputs(
    submissionId: string,
    submission: ClaimedSubmission,
  ): Promise<JudgingInputs | null> {
    const [problem, source, language, earlierAttempts, metaOf] =
      await Promise.all([
        this.problems
          .findById(submission.problem, {
            timeLimit: 1,
            memoryLimit: 1,
            partial: 1,
            languageLimits: 1,
          })
          .lean(),
        this.sources.findById(submissionId).lean(),
        this.languages
          .findById(submission.language, { fileOnly: 1, fileSizeLimit: 1 })
          .lean(),
        this.countEarlierAttempts(submission),
        submission.contest
          ? this.contestMetaOf([submissionId])
          : Promise.resolve(new Map<string, ContestMeta>()),
      ]);
    if (!problem || !source) return null;
    return {
      problem,
      source: language?.fileOnly
        ? this.absoluteFileUrl(source.source)
        : source.source,
      language,
      earlierAttempts,
      contestMeta: metaOf.get(submissionId),
    };
  }

  /** The claimed row lost its problem or source: writes IE (if still claimed by `judgeName`) and returns its graded job, which still goes out. */
  private async finishMissingDataAsIE(
    submissionId: string,
    judgeName: string,
  ): Promise<ClaimOutcome | null> {
    this.logger.error(`Submission ${submissionId} lost its problem or source`);
    const failed = await this.finishWith(
      submissionId,
      judgeName,
      'IE',
      'Submission data is missing',
    );
    return failed && { failed };
  }

  /** Legacy `get_absolute_submission_file_url`: a file source is a media URL, site-relative unless MEDIA_URL is absolute; the judge downloads it. */
  private absoluteFileUrl(source: string): string {
    return ABSOLUTE_URL.test(source)
      ? source
      : new URL(source, this.env.siteUrl).href;
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
    isPretested: boolean,
  ): Promise<boolean> {
    const { modifiedCount } = await this.submissions.updateOne(
      { _id: submissionId, judgedOn: judgeName, status: 'P' },
      {
        $set: {
          status: 'G',
          isPretested,
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

  /** Bridge start: whatever was handed to a judge before the stop goes back to the queue, and is returned so its requeue can be announced. Not a judge failure, so `requeueCount` is untouched and nothing becomes IE. */
  async resetInFlight(): Promise<SubmissionGradedJob[]> {
    return this.resetStranded(await this.inFlightClaims());
  }

  async inFlightClaims(): Promise<InFlightClaim[]> {
    const rows = await this.submissions
      .find({ status: IN_FLIGHT }, { judgedOn: 1 })
      .lean();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      judgedOn: row.judgedOn,
    }));
  }

  /** Resync: P/G rows no connected judge works on go back to QU like a start-up reset; those that did are returned. Each write still requires the row to be in flight under the judge it was read with, so a row that moved on meanwhile is left alone. */
  async resetStranded(claims: InFlightClaim[]): Promise<SubmissionGradedJob[]> {
    const rows = await Promise.all(
      claims.map(({ id, judgedOn }) =>
        this.submissions
          .findOneAndUpdate(
            { _id: id, status: IN_FLIGHT, judgedOn },
            { $set: REQUEUE_RESET },
            { projection: { user: 1, problem: 1 } },
          )
          .lean(),
      ),
    );
    return rows.flatMap((row) => (row ? [gradedJobOf(row)] : []));
  }
}
