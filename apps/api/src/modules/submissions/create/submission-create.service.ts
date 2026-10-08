import { Inject, Injectable } from '@nestjs/common';
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
import { newId, SUBMISSION_PRIORITY, uuidStr } from '@libs/database';
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
    const language = this.assertLanguage(problem, dto.language, false);
    return this.create(auth, problem, language, dto.judgeId, {
      text: dto.source,
    });
  }

  /** Legacy file submission: a multipart form (`language`, optional `judgeId`, `file`) for a file-only language; the file is stored under the media root and its media URL becomes the source (the bridge makes it absolute for the judge). */
  async submitFile(
    auth: AuthContext,
    code: string,
    request: FastifyRequest,
  ): Promise<SubmitResponse> {
    const problem = await this.problems.visibleProblem(auth.principal, code);
    const upload = await readMultipartForm(
      request,
      MAX_UPLOAD_BYTES,
      SUBMIT_FILE_FIELDS,
    );
    const dto = (await validationPipe.transform(upload.fields, {
      type: 'body',
      metatype: SubmitFileDto,
    })) as SubmitFileDto;
    const language = this.assertLanguage(problem, dto.language, true);
    const file = await submittedFile(language, upload);
    const path = `${SUBMISSION_FILE_DIR}/${problem.code}/${auth.principal.userId}/${newId()}.${language.extension}`;
    return this.create(auth, problem, language, dto.judgeId, { file, path });
  }

  /** Not banned, a chosen judge only for editors and only when online with the problem; then the per-user rate, the contest's submission cap and the unfinished-submission limit. */
  private async create(
    auth: AuthContext,
    problem: ProblemDocument,
    language: Language,
    judgeId: string | undefined,
    source: PendingSource,
  ): Promise<SubmitResponse> {
    const { principal } = auth;
    if (
      !principal.isSuperuser &&
      problem.bannedUsers.map(uuidStr).includes(principal.userId)
    )
      throw new AppError(
        'banned_from_problem',
        403,
        'You are banned from submitting to this problem',
      );
    if (judgeId !== undefined)
      await this.assertJudge(principal, problem, judgeId, language.key);
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
      this.insert(
        {
          user: principal.userId,
          problem: problem._id,
          language: language._id,
          ...plan?.fields,
        },
        source,
        plan?.entry ?? null,
      );
    const spams = hasPermission(principal, 'judge.spam_submission');
    const capped = plan !== null && plan.maxSubmissions !== null;
    const guarded = async () => {
      if (
        capped &&
        (await this.participations.countAttempts(
          plan.entry.participation,
          problem._id,
        )) >= plan.maxSubmissions!
      )
        throw new AppError(
          'contest_submission_limit',
          403,
          'You have used every submission allowed for this problem',
        );
      if (
        !spams &&
        !plan?.isFinalFormat &&
        (await this.submissions.countUnfinished(principal.userId)) >=
          UNFINISHED_LIMIT
      )
        throw new AppError(
          'unfinished_submission_limit',
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
    await this.commands.judge([id], judgeId ?? null);
    return { id };
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
      await this.storage.delete(source.path);
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
    takesFile: boolean,
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
    if (language.fileOnly !== takesFile)
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
