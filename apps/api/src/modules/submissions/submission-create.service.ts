import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { hasPermission } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, RateLimitService, REDIS } from '@libs/common';
import { uuidStr } from '@libs/database';
import { BridgeCommandsService } from '@libs/judging';
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
  USER_LOCK_RETRIES,
  USER_LOCK_RETRY_MS,
  USER_LOCK_TTL_MS,
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
    this.assertLanguage(problem, dto.language);
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
      await this.assertJudge(principal, problem, dto.judgeId);
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
      : await this.withUserLock(principal.userId, async () => {
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
        });
    await this.commands.judge([id], dto.judgeId ?? null);
    return { id };
  }

  /** Serialises a user's count-then-insert, so parallel submits cannot all pass the unfinished limit. */
  private async withUserLock<Result>(
    userId: string,
    work: () => Promise<Result>,
  ): Promise<Result> {
    const key = `lock:submit:${userId}`;
    const token = randomUUID();
    for (let attempt = 0; ; attempt += 1) {
      if (
        (await this.redis.set(key, token, 'PX', USER_LOCK_TTL_MS, 'NX')) ===
        'OK'
      )
        break;
      if (attempt >= USER_LOCK_RETRIES)
        throw new AppError(
          'rate_limited',
          429,
          'Another submission is being created; try again',
        );
      await new Promise((resolve) => setTimeout(resolve, USER_LOCK_RETRY_MS));
    }
    try {
      return await work();
    } finally {
      await this.redis.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end",
        1,
        key,
        token,
      );
    }
  }

  private assertLanguage(problem: ProblemDocument, languageId: string): void {
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
  }

  /** Legacy `judge_choices`: editors only, among online judges that have the problem (a mirror: its root). */
  private async assertJudge(
    principal: Principal,
    problem: ProblemDocument,
    judgeName: string,
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
    if (!judged || !(await this.judges.isOnlineFor(judgeName, judged.code)))
      throw invalidField(
        'judgeId',
        'That judge is offline or does not have this problem.',
      );
  }
}
