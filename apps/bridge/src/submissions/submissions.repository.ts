import { lstat } from 'node:fs/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { ENV, unique } from '@libs/common';
import type { Env } from '@libs/common';
import { LIVE, scoresEveryCase } from '@libs/contests';
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
import {
  effectsDue,
  EXTERNAL_JUDGE_NAME,
  gradedJobOf,
  requiredJudgeFeatures,
} from '@libs/judging';
import type { SubmissionGradedJob } from '@libs/judging';
import type { AssignmentRef } from '@libs/judge-proto';
import type { QueuedSubmission } from '../dispatch/slots';
import type { AssignRequest } from './assign-request';
import type { RunBudget } from '../dispatch/run-deadlines';
import { submissionFilePath } from './submission-file-path';

/** Judge disconnects forgiven while a submission is in flight; the next one is an internal error. */
export const MAX_REQUEUES = 1;
/** The problem data fields `requiredJudgeFeatures` reads (`data` is not selected by default). */
const JUDGED_DATA_PROJECTION = {
  'data.grader': 1,
  'data.graderArgs': 1,
  'data.checker': 1,
  'data.customHeader': 1,
  'data.helperHeaders': 1,
  'data.interactiveChecker': 1,
} as const;
/** How judges know a queued submission's problem. */
interface JudgedProblem {
  /** The mirror root's code for a mirror; undefined when that problem is gone. */
  code: string | undefined;
  requiredFeatures: string[];
  /** The judged data's `dataVersion` (the root's for a mirror). */
  dataVersion: number;
  isExternal: boolean;
}
/** The IE message of a claimed row whose problem, source or uploaded file is gone. */
const MISSING_DATA_MESSAGE = 'Submission data is missing';
/** What a reconnecting judge's held run resumes from: the stored seq and its deadline budget, null when the row cannot give one (the problem is gone, or its Started was stored before the case count was kept). */
export interface ResumableRun {
  seq: number;
  budget: RunBudget | null;
}
/** A P/G row, the judge it names and the generation it runs. */
export interface InFlightRun {
  id: string;
  judgedOn: string | null;
  generation: number;
}
/** `failed`: the submission's data vanished, so it was finished as IE and still needs its graded job. */
export type RunClaimOutcome =
  | { request: AssignRequest; subject: SubmissionGradedJob }
  | { failed: SubmissionGradedJob };

/** Back to the queue with partial results dropped; the `$set` of every requeue and reset-in-flight write. A transient wait (`deferral`) starts over: the next attempt is a new one, and only a transient RETRY (which sets it again) keeps it. */
export const REQUEUE_RESET = {
  status: 'QU',
  judgedOn: null,
  judgedDate: null,
  cases: [],
  currentTestcase: 0,
  batch: false,
  error: null,
  judgeSeq: 0,
  deferral: null,
} as const;

/** The claimed row's fields, as `claimIfQueued` projects them. */
type ClaimedSubmission = Pick<
  Submission,
  'user' | 'problem' | 'language' | 'date' | 'contest' | 'judgeGeneration'
> & { _id: string };

/** What `loadJudgingInputs` reads besides the claimed row. */
interface JudgingInputs {
  problem: Pick<
    Problem,
    | 'timeLimit'
    | 'memoryLimit'
    | 'partial'
    | 'languageLimits'
    | 'dataVersion'
    | 'mirrorRoot'
  >;
  source: string;
  language: Pick<Language, 'fileOnly' | 'fileSizeLimit'> | null;
  earlierAttempts: number;
  contestMeta: ContestMeta | undefined;
}

/** What a claimed run adds to `JudgingInputs`. */
interface RunInputs extends JudgingInputs {
  dataVersion: number;
  fileOnly: boolean;
  sourceSize: number;
}

/** The problem's per-language override for a language, if any: its limits win over the problem's. */
const languageLimitOf = (
  problem: Pick<Problem, 'languageLimits'>,
  language: string,
) =>
  problem.languageLimits.find(
    (entry) => uuidStr(entry.languageId) === uuidStr(language),
  );

/** `PROBLEM_LIMITS.memoryLimit.min` is 0; isolate needs a positive `--cg-mem`. */
const MIN_MEMORY_LIMIT_KIB = 1024;

/** The Assign for a claimed run: limits (a per-language override wins; memory at least 1 MiB), the data version, the source or its file, short-circuiting for non-partial problems (not in a contest whose format scores every case), contest meta and the attempt number. Pure. */
function assignRequest(
  queued: QueuedSubmission,
  submission: ClaimedSubmission,
  inputs: RunInputs,
): AssignRequest {
  const { problem, contestMeta } = inputs;
  const limit = languageLimitOf(problem, submission.language);
  return {
    ref: { submissionId: queued.id, generation: submission.judgeGeneration },
    problemCode: queued.problemCode,
    dataVersion: inputs.dataVersion,
    languageKey: queued.languageKey,
    source: inputs.source,
    fileOnly: inputs.fileOnly,
    sourceSize: inputs.sourceSize,
    timeLimit: limit?.timeLimit ?? problem.timeLimit,
    memoryLimit: Math.max(
      MIN_MEMORY_LIMIT_KIB,
      limit?.memoryLimit ?? problem.memoryLimit,
    ),
    shortCircuit: !problem.partial && !contestMeta?.scoresEveryCase,
    pretestsOnly: contestMeta?.pretestsOnly ?? false,
    inContest: contestMeta?.virtual ?? null,
    attemptNo: inputs.earlierAttempts + 1,
    userId: uuidStr(submission.user),
  };
}

/** Filter of one run: the row, the judge it names and the generation it runs. */
const runOf = (ref: AssignmentRef, judgeName: string) => ({
  _id: ref.submissionId,
  judgedOn: judgeName,
  judgeGeneration: ref.generation,
});

const IN_FLIGHT = { $in: [...IN_FLIGHT_STATUSES] };

/** What a contest submission adds to dispatch and to the judge's request. */
export interface ContestMeta {
  /** The participation's number: 0 live, -1 spectate, n virtual (`in-contest`). */
  virtual: number;
  /** Live and spectating rows only (legacy `judge_submission`). */
  bannedJudges: string[];
  /** The contest's current `runPretestsOnly` and the problem's `isPretested` (legacy recomputed it on every judge, so a rejudge after the contest runs every test). */
  pretestsOnly: boolean;
  /** The contest's format scores the submission from its cases even on a non-partial problem (`scoresEveryCase`): no short-circuit. */
  scoresEveryCase: boolean;
}

/** Queue reads, claims and the run transitions that need no judge message (release, requeue, finish, resume, resync); the writes judge messages cause are `RunWritesRepository`'s. */
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

  /** Queued submissions (all, or those of `ids`) in dispatch order; those of a problem the external judge takes only with `external` (then only those), with the codes judges know (a mirror is judged under its root's code), the judge features its root's data needs, and the judge pinned at submit, kept by an accept timeout and a resync (a judge loss or RETRY drops it). A row whose problem or language is gone is skipped. */
  async loadQueued(
    ids?: string[],
    { external = false }: { external?: boolean } = {},
  ): Promise<QueuedSubmission[]> {
    const rows = await this.queuedRows(ids);
    const problems = await this.judgedProblemsOf(
      unique(rows.map((row) => uuidStr(row.problem))),
    );
    const keyOf = await this.languageKeysOf(
      unique(rows.map((row) => uuidStr(row.language))),
    );
    const metaOf = await this.contestMetaOf(
      rows.filter((row) => row.contest).map((row) => uuidStr(row._id)),
    );
    return rows.flatMap((row) => {
      const problem = problems.get(uuidStr(row.problem));
      const languageKey = keyOf.get(uuidStr(row.language));
      if (!problem?.code || !languageKey || problem.isExternal !== external)
        return [];
      return [
        {
          id: uuidStr(row._id),
          problemCode: problem.code,
          languageKey,
          priority: row.priority,
          generation: row.judgeGeneration ?? 0,
          judgeName: row.pinnedJudge ?? null,
          bannedJudges: metaOf.get(uuidStr(row._id))?.bannedJudges ?? [],
          retryBannedJudges: [],
          requiredFeatures: problem.requiredFeatures,
          refusedBy: row.refusedBy ?? [],
          retryAfter: row.deferral?.retryAfter.getTime() ?? 0,
          waitsForData: row.deferral?.reason === 'data',
          dataVersion: problem.dataVersion,
        },
      ];
    });
  }

  /** QU rows (all, or those of `ids`) in dispatch order. */
  private queuedRows(ids?: string[]) {
    return this.submissions
      .find(
        { status: 'QU', ...(ids && { _id: { $in: ids } }) },
        {
          problem: 1,
          language: 1,
          priority: 1,
          contest: 1,
          judgeGeneration: 1,
          pinnedJudge: 1,
          refusedBy: 1,
          deferral: 1,
        },
      )
      .sort({ priority: 1, _id: 1 })
      .lean();
  }

  /** Per problem id: the code judges know it by, the features its data needs and its data version, all from its mirror root when it has one, and whether the external judge takes it. */
  private async judgedProblemsOf(
    problemIds: string[],
  ): Promise<Map<string, JudgedProblem>> {
    const judgedFields = { code: 1, dataVersion: 1, ...JUDGED_DATA_PROJECTION };
    const problems = await this.problems
      .find(
        { _id: { $in: problemIds } },
        { ...judgedFields, mirrorRoot: 1, 'externalJudge.isActive': 1 },
      )
      .lean();
    const rootIds = problems.flatMap((problem) =>
      problem.mirrorRoot ? [uuidStr(problem.mirrorRoot)] : [],
    );
    const roots = rootIds.length
      ? await this.problems
          .find({ _id: { $in: unique(rootIds) } }, judgedFields)
          .lean()
      : [];
    const byId = new Map(
      [...problems, ...roots].map((row) => [uuidStr(row._id), row]),
    );
    return new Map(
      problems.map((problem) => {
        const judged = byId.get(uuidStr(problem.mirrorRoot ?? problem._id));
        const entry: JudgedProblem = {
          code: judged?.code,
          requiredFeatures: judged?.data
            ? requiredJudgeFeatures(judged.data)
            : [],
          dataVersion: judged?.dataVersion ?? 0,
          isExternal: Boolean(problem.externalJudge?.isActive),
        };
        return [uuidStr(problem._id), entry];
      }),
    );
  }

  private async languageKeysOf(
    languageIds: string[],
  ): Promise<Map<string, string>> {
    const languages = await this.languages
      .find({ _id: { $in: languageIds } }, { key: 1 })
      .lean();
    return new Map(
      languages.map((language) => [uuidStr(language._id), language.key]),
    );
  }

  /** Resync: queued rows pinned to a judge that is not connected and were submitted before `olderThan` fall back to any judge (the judge may be blocked, deleted or offline for good). Returns their ids. */
  async unpinAbsent(connected: string[], olderThan: Date): Promise<string[]> {
    const filter = {
      status: 'QU',
      pinnedJudge: { $ne: null, $nin: connected },
      date: { $lt: olderThan },
    };
    const rows = await this.submissions.find(filter, { _id: 1 }).lean();
    const ids = rows.map((row) => uuidStr(row._id));
    if (!ids.length) return [];
    await this.submissions
      .updateMany(
        { ...filter, _id: { $in: ids } },
        { $set: { pinnedJudge: null } },
      )
      .exec();
    return ids;
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
          { bannedJudges: 1, runPretestsOnly: 1, problems: 1, formatName: 1 },
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
              scoresEveryCase: scoresEveryCase(contest.formatName),
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

  /** Compare-and-set QU → P for `judgeName` with the next generation, then the Assign. Null when it is no longer queued (aborted, rejudged, claimed by another judge). */
  async claimRun(
    queued: QueuedSubmission,
    judgeName: string,
  ): Promise<RunClaimOutcome | null> {
    const submission = await this.claimIfQueued(queued.id, judgeName);
    if (!submission) return null;
    const inputs = await this.runInputsOf(queued.id, submission);
    if (inputs)
      return {
        request: assignRequest(queued, submission, inputs),
        subject: gradedJobOf(submission),
      };
    this.logger.error(`Submission ${queued.id} lost its problem or source`);
    const ref = {
      submissionId: queued.id,
      generation: submission.judgeGeneration,
    };
    const failed = await this.finishRun(
      ref,
      judgeName,
      'IE',
      MISSING_DATA_MESSAGE,
    );
    return failed && { failed };
  }

  /** Judging inputs plus what only the new protocol sends: the judged problem's data version and the source size (a file-only upload must be on disk). */
  private async runInputsOf(
    submissionId: string,
    submission: ClaimedSubmission,
  ): Promise<RunInputs | null> {
    const inputs = await this.loadJudgingInputs(submissionId, submission);
    if (!inputs) return null;
    const fileOnly = inputs.language?.fileOnly ?? false;
    const [dataVersion, sourceSize] = await Promise.all([
      this.judgedDataVersion(inputs.problem),
      this.sourceSizeOf(inputs.source, fileOnly),
    ]);
    return sourceSize === null
      ? null
      : { ...inputs, dataVersion, fileOnly, sourceSize };
  }

  /** A mirror is judged with its root's data, so it carries the root's version. */
  private async judgedDataVersion(
    problem: Pick<Problem, 'dataVersion' | 'mirrorRoot'>,
  ): Promise<number> {
    if (!problem.mirrorRoot) return problem.dataVersion ?? 0;
    const root = await this.problems
      .findById(problem.mirrorRoot, { dataVersion: 1 })
      .lean();
    return root?.dataVersion ?? 0;
  }

  /** Bytes of an inline source, or of the uploaded file (a regular file under MEDIA_ROOT/submission_file); null when the file is not there. */
  private async sourceSizeOf(
    source: string,
    fileOnly: boolean,
  ): Promise<number | null> {
    if (!fileOnly) return Buffer.byteLength(source);
    const path = submissionFilePath(this.env, source);
    const stats = path ? await lstat(path).catch(() => null) : null;
    return stats?.isFile() ? stats.size : null;
  }

  /** Writes P and `judgedOn` on the row, but only while it is still QU. */
  private async claimIfQueued(
    submissionId: string,
    judgeName: string,
  ): Promise<ClaimedSubmission | null> {
    return this.submissions
      .findOneAndUpdate(
        { _id: submissionId, status: 'QU' },
        {
          $set: { status: 'P', judgedOn: judgeName, judgeSeq: 0 },
          $inc: { judgeGeneration: 1 },
        },
        {
          new: true,
          projection: {
            user: 1,
            problem: 1,
            language: 1,
            date: 1,
            contest: 1,
            judgeGeneration: 1,
          },
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
            dataVersion: 1,
            mirrorRoot: 1,
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
      source: source.source,
      language,
      earlierAttempts,
      contestMeta: metaOf.get(submissionId),
    };
  }

  /** A run its judge never accepted (accept timeout) or never received: back to QU without spending the requeue. */
  async releaseRun(ref: AssignmentRef, judgeName: string): Promise<boolean> {
    const { modifiedCount } = await this.submissions.updateOne(
      { ...runOf(ref, judgeName), status: 'P', judgeSeq: 0 },
      { $set: { status: 'QU', judgedOn: null } },
    );
    return modifiedCount === 1;
  }

  /** The grace of a lost judge expired: back to QU with partial results dropped and the requeue spent; null once it is spent or the row moved on. */
  async requeueRun(
    ref: AssignmentRef,
    judgeName: string,
  ): Promise<SubmissionGradedJob | null> {
    const row = await this.submissions
      .findOneAndUpdate(
        {
          ...runOf(ref, judgeName),
          status: IN_FLIGHT,
          requeueCount: { $not: { $gte: MAX_REQUEUES } },
        },
        // the pinned judge failed it: any judge may take it now
        {
          $set: { ...REQUEUE_RESET, pinnedJudge: null },
          $inc: { requeueCount: 1 },
        },
        { projection: { user: 1, problem: 1 } },
      )
      .lean();
    return row && gradedJobOf(row);
  }

  /** Ends a run without a judge message: IE on the second judge loss or missing data, AB for an abort recorded during the grace. */
  async finishRun(
    ref: AssignmentRef,
    judgeName: string,
    status: 'IE' | 'AB',
    error: string | null,
  ): Promise<SubmissionGradedJob | null> {
    const row = await this.submissions
      .findOneAndUpdate(
        { ...runOf(ref, judgeName), status: IN_FLIGHT },
        {
          $set: {
            ...(status === 'AB'
              ? { status, result: status, points: 0 }
              : { status, result: status, error }),
            ...effectsDue(),
          },
        },
        { projection: { user: 1, problem: 1 } },
      )
      .lean();
    return row && gradedJobOf(row);
  }

  /** A run a reconnecting judge still holds; null when the row moved on (another judge or generation, or no longer P/G). */
  async resumableRun(
    ref: AssignmentRef,
    judgeName: string,
  ): Promise<ResumableRun | null> {
    const row = await this.submissions
      .findOne(
        { ...runOf(ref, judgeName), status: IN_FLIGHT },
        { judgeSeq: 1, judgeCaseCount: 1, status: 1, problem: 1, language: 1 },
      )
      .lean();
    if (!row) return null;
    const problem = await this.problems
      .findById(row.problem, { timeLimit: 1, languageLimits: 1 })
      .lean();
    // a P row's count is an earlier generation's: its Started is still to come
    const caseCount = row.status === 'G' ? (row.judgeCaseCount ?? null) : null;
    if (!problem || (row.status === 'G' && caseCount === null))
      return { seq: row.judgeSeq, budget: null };
    const timeLimitSeconds =
      languageLimitOf(problem, row.language)?.timeLimit ?? problem.timeLimit;
    return { seq: row.judgeSeq, budget: { timeLimitSeconds, caseCount } };
  }

  /** P/G runs of judges; the external adapter's (`@external`) are its own to recover. */
  async inFlightRuns(): Promise<InFlightRun[]> {
    const rows = await this.submissions
      .find(
        { status: IN_FLIGHT, judgedOn: { $ne: EXTERNAL_JUDGE_NAME } },
        { judgedOn: 1, judgeGeneration: 1 },
      )
      .lean();
    return rows.map((row) => ({
      id: uuidStr(row._id),
      judgedOn: row.judgedOn,
      generation: row.judgeGeneration ?? 0,
    }));
  }

  /** Resync: P/G runs no session or grace holds go back to QU without spending `requeueCount`; each write still requires the run read, so a row that moved on is left alone. */
  async resetStrandedRuns(runs: InFlightRun[]): Promise<SubmissionGradedJob[]> {
    const rows = await Promise.all(
      runs.map(({ id, judgedOn, generation }) =>
        this.submissions
          .findOneAndUpdate(
            {
              _id: id,
              status: IN_FLIGHT,
              judgedOn,
              judgeGeneration: generation,
            },
            { $set: REQUEUE_RESET },
            { projection: { user: 1, problem: 1 } },
          )
          .lean(),
      ),
    );
    return rows.flatMap((row) => (row ? [gradedJobOf(row)] : []));
  }

  /** Whom a submission's graded job and events name. */
  async gradedSubjectOf(
    submissionId: string,
  ): Promise<SubmissionGradedJob | null> {
    const row = await this.submissions
      .findById(submissionId, { user: 1, problem: 1 })
      .lean();
    return row && gradedJobOf(row);
  }

  /** The stored source (a media URL for a file-only language). */
  async sourceOf(submissionId: string): Promise<string | null> {
    const row = await this.sources.findById(submissionId, { source: 1 }).lean();
    return row?.source ?? null;
  }
}
