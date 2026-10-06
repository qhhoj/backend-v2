import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { hasPermission } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, RateLimitService, REDIS, withRedisLock } from '@libs/common';
import { uuidStr } from '@libs/database';
import {
  BridgeCommandsService,
  submissionEvent,
  SubmissionEventsService,
} from '@libs/judging';
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

const invalidField = (field: string, message: string) =>
  new AppError('validation_failed', 400, message, { [field]: [message] });

/** Legacy `ProblemSubmit.form_valid`. */
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
    const create = () =>
      this.submissions.create(
        {
          user: principal.userId,
          problem: problem._id,
          language: dto.language,
        },
        dto.source,
      );
    const id = hasPermission(principal, 'judge.spam_submission')
      ? await create()
      : await withRedisLock(
          this.redis,
          `submit-lock:user:${principal.userId}`,
          USER_LOCK_SECONDS,
          'Another submission is being created; try again',
          async () => {
            if (
              (await this.submissions.countUnfinished(principal.userId)) >=
              UNFINISHED_LIMIT
            )
              throw new AppError(
                'rate_limited',
                429,
                'Wait until your earlier submissions are judged',
              );
            return create();
          },
        );
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
