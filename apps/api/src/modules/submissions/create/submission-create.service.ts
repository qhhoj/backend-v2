import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { hasPermission } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import {
  AppError,
  invalidField,
  MAX_UPLOAD_BYTES,
  RateLimitService,
  REDIS,
  StorageService,
  validationPipe,
  withRedisLock,
} from '@libs/common';
import { contestPhase, LIVE } from '@libs/contests';
import { SUBMISSION_PRIORITY, uuidStr } from '@libs/database';
import type { Language } from '@libs/database';
import {
  BridgeCommandsService,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
import { ParticipationsRepository } from '../../contests/core/participations.repository';
import { CurrentContestService } from '../../contests/core/current-contest.service';
import type { CurrentParticipation } from '../../contests/core/current-contest.service';
import { JudgesRepository } from '../../judges/judges.repository';
import { LanguagesQuerier } from '../../problems/catalog/languages.querier';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import type { ProblemDocument } from '../../problems/core/problems.repository';
import { ProblemsService } from '../../problems/core/problems.service';
import { readMultipartForm } from '../../problems/core/multipart';
import { SUBMIT_FILE_FIELDS, SubmitFileDto } from './dto/submit-file.dto';
import type { SubmitDto } from './dto/submit.dto';
import type { SubmitResponse } from './dto/submit.response';
import { SUBMISSION_FILE_DIR, submittedFile } from './submission-file';
import {
  SUBMIT_LIMIT,
  SUBMIT_WINDOW_SECONDS,
  UNFINISHED_LIMIT,
  USER_LOCK_SECONDS,
} from '../core/rate-limits';
import { SubmissionsRepository } from '../core/submissions.repository';
import type {
  NewContestSubmission,
  NewSubmission,
} from '../core/submissions.repository';

/** How a submission inside the current contest is stored. */
interface ContestPlan {
  fields: Omit<NewSubmission, 'user' | 'problem' | 'language'>;
  entry: NewContestSubmission;
  maxSubmissions: number | null;
  /** A running FSO contest: stored PD, judged at its end. */
  finalOnly: boolean;
  /** Any FSO contest, running or not (legacy `in_fso_contest`): its submissions skip the unfinished limit. */
  isFinalFormat: boolean;
}

/** Typed text, or an upload that is saved to media just before its row is written and removed again if the row is not. */
type PendingSource = { text: string } | { file: Buffer; path: string };

/** What one submit call wants stored and judged. */
interface SubmissionDraft {
  problem: ProblemDocument;
  language: Language;
  judgeId: string | undefined;
  source: PendingSource;
}

function assertNotBanned(principal: Principal, problem: ProblemDocument): void {
  if (
    !principal.isSuperuser &&
    problem.bannedUsers.map(uuidStr).includes(principal.userId)
  )
    throw new AppError(
      'banned_from_problem',
      403,
      'You are banned from submitting to this problem',
    );
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
    private readonly participations: ParticipationsRepository,
    private readonly storage: StorageService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** A typed source for a language that is not file-only. */
  async submit(
    auth: AuthContext,
    code: string,
    dto: SubmitDto,
  ): Promise<SubmitResponse> {
    const problem = await this.problems.visibleProblem(auth.principal, code);
    await this.reserveSubmit(auth.principal);
    const language = this.assertLanguage(problem, dto.language, {
      isFileUpload: false,
    });
    return this.create(auth.principal, {
      problem,
      language,
      judgeId: dto.judgeId,
      source: { text: dto.source },
    });
  }

  /** Legacy file submission: a multipart form (`language`, optional `judgeId`, `file`) for a file-only language; the file is stored under the media root and its media URL becomes the source (the bridge makes it absolute for the judge). */
  async submitFile(
    auth: AuthContext,
    code: string,
    request: FastifyRequest,
  ): Promise<SubmitResponse> {
    const problem = await this.problems.visibleProblem(auth.principal, code);
    await this.reserveSubmit(auth.principal);
    const upload = await readMultipartForm(
      request,
      MAX_UPLOAD_BYTES,
      SUBMIT_FILE_FIELDS,
    );
    const dto = (await validationPipe.transform(upload.fields, {
      type: 'body',
      metatype: SubmitFileDto,
    })) as SubmitFileDto;
    const language = this.assertLanguage(problem, dto.language, {
      isFileUpload: true,
    });
    const file = await submittedFile(language, upload);
    const path = `${SUBMISSION_FILE_DIR}/${problem.code}/${auth.principal.userId}/${randomUUID()}.${language.extension}`;
    return this.create(auth.principal, {
      problem,
      language,
      judgeId: dto.judgeId,
      source: { file, path },
    });
  }

  /** Every attempt spends the per-user submit budget, taken before an upload is read (never released). */
  private async reserveSubmit(principal: Principal): Promise<void> {
    await this.rateLimit.reserve(
      [`submit:user:${principal.userId}`],
      SUBMIT_LIMIT,
      SUBMIT_WINDOW_SECONDS,
    );
  }

  /** Not banned, a chosen judge only for editors and only when online with the problem; then the contest's submission cap and the unfinished-submission limit. */
  private async create(
    principal: Principal,
    draft: SubmissionDraft,
  ): Promise<SubmitResponse> {
    assertNotBanned(principal, draft.problem);
    if (draft.judgeId !== undefined)
      await this.assertJudge(
        principal,
        draft.problem,
        draft.judgeId,
        draft.language.key,
      );
    const plan = this.contestPlan(
      await this.currentContest.current(principal),
      draft.problem._id,
      new Date(),
    );
    const id = await this.insertWithinLimits(principal, draft, plan);
    if (!plan?.finalOnly) await this.announceQueued(id, principal, draft);
    return { id };
  }

  /** Spam-permitted users skip the per-user lock unless a contest cap applies; everyone else counts under it, so two parallel submits cannot both pass a limit. */
  private insertWithinLimits(
    principal: Principal,
    draft: SubmissionDraft,
    plan: ContestPlan | null,
  ): Promise<string> {
    const insertRow = () =>
      this.insert(
        {
          user: principal.userId,
          problem: draft.problem._id,
          language: draft.language._id,
          ...plan?.fields,
        },
        draft.source,
        plan?.entry ?? null,
      );
    const canSpam = hasPermission(principal, 'judge.spam_submission');
    const contestCap = plan?.maxSubmissions ?? null;
    if (canSpam && contestCap === null) return insertRow();
    return withRedisLock(
      this.redis,
      `submit-lock:user:${principal.userId}`,
      USER_LOCK_SECONDS,
      'Another submission is being created; try again',
      async () => {
        if (plan && contestCap !== null)
          await this.assertUnderContestCap(
            plan.entry.participation,
            draft.problem._id,
            contestCap,
          );
        if (!canSpam && !plan?.isFinalFormat)
          await this.assertUnderUnfinishedLimit(principal.userId);
        return insertRow();
      },
    );
  }

  private async assertUnderContestCap(
    participationId: string,
    problemId: string,
    maxSubmissions: number,
  ): Promise<void> {
    if (
      (await this.participations.countAttempts(participationId, problemId)) >=
      maxSubmissions
    )
      throw new AppError(
        'contest_submission_limit',
        403,
        'You have used every submission allowed for this problem',
      );
  }

  private async assertUnderUnfinishedLimit(userId: string): Promise<void> {
    if ((await this.submissions.countUnfinished(userId)) >= UNFINISHED_LIMIT)
      throw new AppError(
        'unfinished_submission_limit',
        429,
        'Wait until your earlier submissions are judged',
      );
  }

  /** Publishes the queued event, then asks the bridge to judge the row (on the chosen judge, or any when none). */
  private async announceQueued(
    submissionId: string,
    principal: Principal,
    { problem, judgeId }: SubmissionDraft,
  ): Promise<void> {
    await this.events.publish(
      submissionEvent(
        { submissionId, userId: principal.userId, problemId: problem._id },
        'queued',
        'QU',
      ),
    );
    await this.commands.judge([submissionId], judgeId ?? null);
  }

  private async insert(
    fields: NewSubmission,
    source: PendingSource,
    contestEntry: NewContestSubmission | null,
  ): Promise<string> {
    if ('text' in source)
      return this.submissions.create(fields, source.text, contestEntry);
    const url = await this.storage.save(source.path, source.file);
    try {
      return await this.submissions.create(fields, url, contestEntry);
    } catch (error) {
      await this.storage.delete(source.path).catch(() => undefined);
      throw error;
    }
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
    const isFinalFormat = contest.formatName === 'final_submission';
    const finalOnly = isFinalFormat && contestPhase(contest, now) !== 'ended';
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
      isFinalFormat,
    };
  }

  /** An allowed language of the problem, file-only exactly when the route takes a file. */
  private assertLanguage(
    problem: ProblemDocument,
    languageId: string,
    { isFileUpload }: { isFileUpload: boolean },
  ): Language {
    const language = this.languages.byId(languageId);
    if (
      !language ||
      !problem.allowedLanguages.map(uuidStr).includes(languageId)
    )
      throw invalidField(
        'language',
        'This language is not allowed for this problem.',
      );
    if (language.fileOnly !== isFileUpload)
      throw language.fileOnly
        ? invalidField(
            'language',
            'This language takes a file: use the file submit route.',
            'language_takes_file',
          )
        : invalidField(
            'language',
            'This language takes a typed source, not a file.',
            'language_takes_text',
          );
    return language;
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
