import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { RateLimitService, sameJson, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { ProblemTranslation, StatementLanguage } from '@libs/database';
import { PutEditorialDto } from './dto/editorial.dto';
import { RenderPreviewDto } from './dto/render-preview.dto';
import { PutTranslationDto } from './dto/translation.dto';
import {
  isTrustedMarkupWriter,
  markupTrustAfterSave,
  renderField,
  styleOf,
} from './problem-markup';
import { ProblemEditPolicyService } from './problem-edit-policy.service';
import { ProblemEvents } from '../core/problem.events';
import { ProblemsRepository } from '../core/problems.repository';
import {
  RENDER_PREVIEW_LIMIT,
  RENDER_PREVIEW_WINDOW_SECONDS,
} from '../core/rate-limits';
import { RevisionsRepository } from '../core/revisions.repository';

/** Statement text outside the problem document's own fields: translations, editorial and the markdown preview. */
@Injectable()
export class ProblemStatementEditingService {
  constructor(
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly policy: ProblemEditPolicyService,
    private readonly events: ProblemEvents,
    private readonly rateLimit: RateLimitService,
  ) {}

  /** Saves the translation; its trust (see `markupTrustAfterSave`) picks the render style. Sending the stored text again writes nothing, unless a trusted writer vouches for untrusted text. */
  async putTranslation(
    auth: AuthContext,
    code: string,
    lang: StatementLanguage,
    dto: PutTranslationDto,
  ): Promise<void> {
    const { principal } = auth;
    const problem = await this.policy.editableProblem(principal, code);
    const previous = problem.translations.find(
      (translation) => translation.language === lang,
    );
    const isDescriptionChanged = dto.description !== previous?.description;
    if (problem.isFullMarkup && isDescriptionChanged)
      this.policy.assertFullMarkupWriter(principal);
    const wasTrusted = previous?.isMarkupTrusted ?? false;
    const isMarkupTrusted = markupTrustAfterSave({
      isWriterTrusted: isTrustedMarkupWriter(principal),
      isTextChanged: isDescriptionChanged,
      wasTrusted,
    });
    const isTextChanged = isDescriptionChanged || previous?.name !== dto.name;
    if (!isTextChanged && isMarkupTrusted === wasTrusted) return;
    await this.repository.upsertTranslation(problem._id, {
      language: lang,
      name: dto.name,
      description: dto.description,
      isMarkupTrusted,
      descriptionHtml: renderField(
        dto.description,
        styleOf(problem, isMarkupTrusted),
        'description',
      ),
    });
    if (isTextChanged)
      await this.recordTranslationEdit(principal.userId, problem._id, lang, {
        previous,
        dto,
      });
    this.events.emit('statementChanged', problem._id);
  }

  private recordTranslationEdit(
    userId: string,
    problemId: string,
    lang: StatementLanguage,
    {
      previous,
      dto,
    }: { previous: ProblemTranslation | undefined; dto: PutTranslationDto },
  ) {
    return this.revisions.append({
      entity: 'problem',
      entityId: problemId,
      action: 'translation',
      userId,
      changes: {
        [`translations.${lang}`]: {
          before: previous
            ? { name: previous.name, description: previous.description }
            : null,
          after: { name: dto.name, description: dto.description },
        },
      },
      comment: `Translation ${lang} edited from site`,
    });
  }

  /** The editorial always renders with the sanitizing `solution` style, so it needs no full-markup gate. */
  async putEditorial(
    auth: AuthContext,
    code: string,
    dto: PutEditorialDto,
  ): Promise<void> {
    const problem = await this.policy.editableProblem(auth.principal, code);
    await this.policy.assertReferences({ authors: dto.authors });
    const authors = unique(dto.authors);
    const before = problem.solution && {
      isPublic: problem.solution.isPublic,
      publishOn: problem.solution.publishOn,
      authors: problem.solution.authors.map(uuidStr),
      content: problem.solution.content,
    };
    const after = {
      isPublic: dto.isPublic,
      publishOn: new Date(dto.publishOn),
      authors,
      content: dto.content,
    };
    if (before && sameJson(before, after)) return;
    await this.repository.update(problem._id, {
      solution: {
        ...after,
        contentHtml: renderField(dto.content, 'solution', 'content'),
      },
    });
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: 'editorial',
      userId: auth.principal.userId,
      changes: { solution: { before, after } },
      comment: 'Editorial edited from site',
    });
  }

  async preview(
    auth: AuthContext,
    dto: RenderPreviewDto,
  ): Promise<{ html: string }> {
    if (dto.style === 'problem-full')
      this.policy.assertFullMarkupWriter(auth.principal);
    await this.rateLimit.reserve(
      [`render-preview:user:${auth.principal.userId}`],
      RENDER_PREVIEW_LIMIT,
      RENDER_PREVIEW_WINDOW_SECONDS,
    );
    return { html: renderField(dto.markdown, dto.style, 'markdown') };
  }
}
