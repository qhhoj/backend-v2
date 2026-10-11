import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { AppError } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { ExternalJudgeLink } from '@libs/database';
import { ExternalJudgeClient } from '@libs/judging';
import { fieldDiff } from '@libs/problems';
import { LanguagesQuerier } from '../catalog/languages.querier';
import { ProblemEditPolicyService } from '../editing/problem-edit-policy.service';
import type { ProblemDocument } from '../core/problems.repository';
import { ProblemsRepository } from '../core/problems.repository';
import { RevisionsRepository } from '../core/revisions.repository';
import type { PutExternalJudgeDto } from './dto/external-judge.dto';
import type {
  ExternalJudgeLinkResponse,
  ProblemExternalJudgeResponse,
} from './dto/external-judge.response';

/** The two fields a link change writes, in the form a revision records. */
function linkFields(problem: ProblemDocument) {
  return {
    externalJudge: problem.externalJudge && linkResponse(problem.externalJudge),
    allowedLanguages: problem.allowedLanguages.map(uuidStr),
  };
}

function linkResponse(link: ExternalJudgeLink): ExternalJudgeLinkResponse {
  return {
    isActive: link.isActive,
    oj: link.oj,
    problemId: link.problemId,
    title: link.title,
    languages: link.languages.map((entry) => ({
      languageId: uuidStr(entry.language),
      remoteId: entry.remoteId,
      remoteName: entry.remoteName,
    })),
    verifiedAt: link.verifiedAt,
  };
}

/** A problem's external judge link: read, replace, remove. Its editors may change it (as on the old site). */
@Injectable()
export class ProblemExternalJudgeService {
  constructor(
    private readonly policy: ProblemEditPolicyService,
    private readonly problems: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly languages: LanguagesQuerier,
    private readonly client: ExternalJudgeClient,
  ) {}

  async get(
    auth: AuthContext,
    code: string,
  ): Promise<ProblemExternalJudgeResponse> {
    const problem = await this.policy.editableProblem(auth.principal, code);
    return this.answer(problem);
  }

  /** Stores the link; while active, `allowedLanguages` become exactly the mapped languages, so the submit check only offers what the remote OJ takes. */
  async put(
    auth: AuthContext,
    code: string,
    dto: PutExternalJudgeDto,
  ): Promise<ProblemExternalJudgeResponse> {
    const problem = await this.policy.editableProblem(auth.principal, code);
    this.assertMappable(dto);
    const link = this.linkOf(problem.externalJudge, dto);
    const changes: Record<string, unknown> = { externalJudge: link };
    if (link.isActive)
      changes.allowedLanguages = link.languages.map((entry) => entry.language);
    return this.write(auth, problem, changes);
  }

  /** The problem goes back to judge-v2; `allowedLanguages` stay as they are. */
  async remove(
    auth: AuthContext,
    code: string,
  ): Promise<ProblemExternalJudgeResponse> {
    const problem = await this.policy.editableProblem(auth.principal, code);
    return this.write(auth, problem, { externalJudge: null });
  }

  private async write(
    auth: AuthContext,
    original: ProblemDocument,
    changes: Record<string, unknown>,
  ): Promise<ProblemExternalJudgeResponse> {
    const before = linkFields(original);
    await this.problems.update(original._id, changes);
    const updated = await this.problems.findById(original._id);
    if (!updated) throw new AppError('not_found', 404, 'No such problem');
    const diff = fieldDiff(before, linkFields(updated));
    if (Object.keys(diff).length)
      await this.revisions.append({
        entity: 'problem',
        entityId: original._id,
        action: 'edit',
        userId: auth.principal.userId,
        changes: diff,
        comment: 'External judge changed',
      });
    return this.answer(updated);
  }

  private answer(problem: ProblemDocument): ProblemExternalJudgeResponse {
    return {
      connected: this.client.isConfigured(),
      link: problem.externalJudge && linkResponse(problem.externalJudge),
    };
  }

  /** Every mapped language exists and takes typed source. */
  private assertMappable(dto: PutExternalJudgeDto): void {
    const problems = dto.languages.flatMap(({ languageId }) => {
      const language = this.languages.byId(languageId);
      if (!language) return [`Unknown language ${languageId}.`];
      return language.fileOnly
        ? [`${language.name} takes a file and cannot be mapped.`]
        : [];
    });
    if (problems.length)
      throw new AppError('validation_failed', 400, 'Invalid language mapping', {
        languages: problems,
      });
  }

  /** The title and verification stamp follow the request, else carry over while the link still points at the same remote problem. */
  private linkOf(
    existing: ExternalJudgeLink | null,
    dto: PutExternalJudgeDto,
  ): ExternalJudgeLink {
    const isSame =
      existing?.oj === dto.oj && existing.problemId === dto.problemId;
    return {
      isActive: dto.isActive,
      oj: dto.oj,
      problemId: dto.problemId,
      title: dto.title ?? (isSame ? existing.title : ''),
      languages: dto.languages.map((entry) => ({
        language: entry.languageId,
        remoteId: entry.remoteId,
        remoteName: entry.remoteName ?? '',
      })),
      verifiedAt:
        dto.title !== undefined
          ? new Date()
          : isSame
            ? existing.verifiedAt
            : null,
    };
  }
}
