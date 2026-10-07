import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { hasPermission } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, RateLimitService, REDIS, withRedisLock } from '@libs/common';
import { contestPhase, LIVE } from '@libs/contests';
import { SUBMISSION_PRIORITY, uuidStr } from '@libs/database';
import {
  BridgeCommandsService,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import { CurrentContestService } from '../contests/current-contest.service';
import type { CurrentParticipation } from '../contests/current-contest.service';
import { JudgesRepository } from '../judges/judges.repository';
import { LanguagesQuerier } from '../problems/languages.querier';
import { ProblemAccess } from '../problems/problem-access';
import { ProblemsRepository } from '../problems/problems.repository';
import type { ProblemDocument } from '../problems/problems.repository';
import { ProblemsService } from '../problems/problems.service';
import type { SubmitDto } from './dto/submit.dto';
import type { SubmitResponse } from './dto/submit.response';
import {
  SUBMIT_LIMIT,
  SUBMIT_WINDOW_SECONDS,
  UNFINISHED_LIMIT,
  USER_LOCK_SECONDS,
} from './rate-limits';
import { SubmissionsRepository } from './submissions.repository';
import type {
  NewContestSubmission,
  NewSubmission,
} from './submissions.repository';

const invalidField = (field: string, message: string) =>
  new AppError('validation_failed', 400, message, { [field]: [message] });

/** How a submission inside the current contest is stored. */
interface ContestPlan {
  fields: Omit<NewSubmission, 'user' | 'problem' | 'language'>;
  entry: NewContestSubmission;
  maxSubmissions: number | null;
  /** A running FSO contest: stored PD, judged at its end. */
  finalOnly: boolean;
}

/** Legacy `ProblemSubmit.form_valid`; inside a current contest that lists the problem the submission is a contest submission (priority 0, lock, pretests, `maxSubmissions`, FSO pending). */
@Injectable()
export class SubmissionCreateService {
  constructor(
    private readonly problems: ProblemsService,
    private readonly problemsRepository: ProblemsRepository,
    private readonly languages: LanguagesQuerier,
    private readonly judges: JudgesRepository,
    private readonly submissions: SubmissionsRepository,
    private readonly commands: BridgeCommandsService,
    private readonly events: SubmissionEventsService,
    private readonly rateLimit: RateLimitService,
    private readonly currentContest: CurrentContestService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Visible problem, allowed (and not file-only) language, not banned, a chosen judge only for editors and only when online with the problem; then the per-user rate and the unfinished-submission limit. */
  async submit(
    auth: AuthContext,
    code: string,
    dto: SubmitDto,
  ): Promise<SubmitResponse> {
    const { principal } = auth;
    const problem = await this.problems.visibleProblem(principal, code);
    const languageKey = this.assertLanguage(problem, dto.language);
    if (
      !principal.isSuperuser &&
      problem.bannedUsers.map(uuidStr).includes(principal.userId)
    )
      throw new AppError(
        'forbidden',
        403,
        'You are banned from submitting to this problem',
      );
    if (dto.judgeId !== undefined)
      await this.assertJudge(principal, problem, dto.judgeId, languageKey);
    await this.rateLimit.reserve(
      [`submit:user:${principal.userId}`],
      SUBMIT_LIMIT,
      SUBMIT_WINDOW_SECONDS,
    );
    const plan = this.contestPlan(
      await this.currentContest.current(principal),
      problem._id,
      new Date(),
    );
    const create = () =>
      this.submissions.create(
        {
          user: principal.userId,
          problem: problem._id,
          language: dto.language,
          ...plan?.fields,
        },
        dto.source,
        plan?.entry ?? null,
      );
    const spams = hasPermission(principal, 'judge.spam_submission');
    const capped = plan !== null && plan.maxSubmissions !== null;
    const guarded = async () => {
      if (
        capped &&
        (await this.submissions.countContestAttempts(
          plan.entry.participation,
          problem._id,
        )) >= plan.maxSubmissions!
      )
        throw new AppError(
          'forbidden',
          403,
          'You have used every submission allowed for this problem',
        );
      if (
        !spams &&
        !plan?.finalOnly &&
        (await this.submissions.countUnfinished(principal.userId)) >=
          UNFINISHED_LIMIT
      )
        throw new AppError(
          'rate_limited',
          429,
          'Wait until your earlier submissions are judged',
        );
      return create();
    };
    const id =
      spams && !capped
        ? await create()
        : await withRedisLock(
            this.redis,
            `submit-lock:user:${principal.userId}`,
            USER_LOCK_SECONDS,
            'Another submission is being created; try again',
            guarded,
          );
    if (plan?.finalOnly) return { id };
    await this.events.publish(
      submissionEvent(
        { submissionId: id, userId: principal.userId, problemId: problem._id },
        'queued',
        'QU',
      ),
    );
    await this.commands.judge([id], dto.judgeId ?? null);
    return { id };
  }

  /** Legacy `form_valid` in a contest: only when the current contest lists the problem. */
  private contestPlan(
    current: CurrentParticipation | null,
    problemId: string,
    now: Date,
  ): ContestPlan | null {
    const entry = current?.contest.problems.find(
      (candidate) => uuidStr(candidate.problem) === problemId,
    );
    if (!current || !entry) return null;
    const { contest, participation } = current;
    const isPretest = contest.runPretestsOnly && entry.isPretested;
    const finalOnly =
      contest.formatName === 'final_submission' &&
      contestPhase(contest, now) !== 'ended';
    return {
      fields: {
        priority: SUBMISSION_PRIORITY.contest,
        contest: contest._id,
        lockedAfter:
          participation.virtual === LIVE ? contest.lockedAfter : null,
        isPretested: isPretest,
        status: finalOnly ? 'PD' : 'QU',
      },
      entry: {
        participation: participation._id,
        contest: contest._id,
        problem: problemId,
        isPretest,
      },
      maxSubmissions: entry.maxSubmissions,
      finalOnly,
    };
  }

  /** Returns the language's key, the name judges know it by. */
  private assertLanguage(problem: ProblemDocument, languageId: string): string {
    const language = this.languages.byId(languageId);
    if (
      !language ||
      !problem.allowedLanguages.map(uuidStr).includes(languageId)
    )
      throw invalidField(
        'language',
        'This language is not allowed for this problem.',
      );
    if (language.fileOnly)
      throw invalidField('language', 'File submissions are not supported yet.');
    return language.key;
  }

  /** Legacy `judge_choices`: editors only, among online judges that have the problem (a mirror: its root) and run the language. */
  private async assertJudge(
    principal: Principal,
    problem: ProblemDocument,
    judgeName: string,
    languageKey: string,
  ): Promise<void> {
    if (!ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem)))
      throw new AppError(
        'forbidden',
        403,
        'Only problem editors can choose a judge',
      );
    const judged = problem.mirrorRoot
      ? await this.problemsRepository.findById(uuidStr(problem.mirrorRoot))
      : problem;
    if (
      !judged ||
      !(await this.judges.isOnlineFor(judgeName, judged.code, languageKey))
    )
      throw invalidField(
        'judgeId',
        'That judge is offline, or lacks this problem or language.',
      );
  }
}
