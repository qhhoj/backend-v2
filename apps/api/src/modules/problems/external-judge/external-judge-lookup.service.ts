import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError, RateLimitService } from '@libs/common';
import { ExternalJudgeClient, SEARCH_PAGE_SIZE } from '@libs/judging';
import { LanguagesQuerier } from '../catalog/languages.querier';
import {
  EXTERNAL_JUDGE_LOOKUP_LIMIT,
  EXTERNAL_JUDGE_LOOKUP_WINDOW_SECONDS,
} from '../core/rate-limits';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import type {
  ExternalJudgeSearchDto,
  ExternalJudgeVerifyDto,
} from './dto/external-judge.dto';
import type {
  ExternalJudgeSearchResponse,
  ExternalJudgeVerifyResponse,
} from './dto/external-judge.response';
import { askExternalJudge } from './external-judge-errors';
import { suggestLanguage } from './suggest-language';

/** What a problem editor asks the external judge: find a remote problem, and read its languages. */
@Injectable()
export class ExternalJudgeLookupService {
  constructor(
    private readonly client: ExternalJudgeClient,
    private readonly policy: ProblemEditPolicyService,
    private readonly languages: LanguagesQuerier,
    private readonly rateLimit: RateLimitService,
  ) {}

  async search(
    auth: AuthContext,
    code: string,
    dto: ExternalJudgeSearchDto,
  ): Promise<ExternalJudgeSearchResponse> {
    if (!dto.oj && !dto.problemId)
      throw new AppError(
        'validation_failed',
        400,
        'Give an OJ or a problem id to search for',
        { oj: ['Give an OJ or a problem id.'] },
      );
    await this.admit(auth, code);
    const page = await askExternalJudge(() =>
      this.client.search(
        { oj: dto.oj ?? '', problemId: dto.problemId ?? '' },
        dto.page ?? 1,
      ),
    );
    return { ...page, pageSize: SEARCH_PAGE_SIZE };
  }

  async verify(
    auth: AuthContext,
    code: string,
    dto: ExternalJudgeVerifyDto,
  ): Promise<ExternalJudgeVerifyResponse> {
    await this.admit(auth, code);
    const problem = await askExternalJudge(() =>
      this.client.problem(dto.oj, dto.problemId),
    );
    const siteLanguages = this.languages.all().filter((one) => !one.fileOnly);
    return {
      oj: problem.oj,
      problemId: problem.problemId,
      title: problem.title,
      languages: problem.languages.map(({ id, name }) => ({
        remoteId: id,
        remoteName: name,
        suggestedLanguageId: suggestLanguage(name, siteLanguages),
      })),
    };
  }

  /** The caller edits the problem, then spends one of their lookups. */
  private async admit(auth: AuthContext, code: string): Promise<void> {
    await this.policy.editableProblem(auth.principal, code);
    await this.rateLimit.reserve(
      [`external-judge-lookup:user:${auth.principal.userId}`],
      EXTERNAL_JUDGE_LOOKUP_LIMIT,
      EXTERNAL_JUDGE_LOOKUP_WINDOW_SECONDS,
    );
  }
}
