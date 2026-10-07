import { Injectable } from '@nestjs/common';
import type { AuthContext } from '@libs/auth';
import { RateLimitService, unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { StatementLanguage } from '@libs/database';
import { PutEditorialDto } from './dto/editorial.dto';
import { RenderPreviewDto } from './dto/render-preview.dto';
import { PutTranslationDto } from './dto/translation.dto';
import { sameJson } from './problem-edit-fields';
import { renderField, styleOf } from './problem-markup';
import { ProblemEditPolicy } from './problem-edit-policy.service';
import { ProblemEvents } from './problem.events';
import { ProblemsRepository } from './problems.repository';
import {
  RENDER_PREVIEW_LIMIT,
  RENDER_PREVIEW_WINDOW_SECONDS,
} from './rate-limits';
import { RevisionsRepository } from './revisions.repository';

/** Statement text outside the problem document's own fields: translations, editorial and the markdown preview. */
@Injectable()
export class ProblemStatementEditingService {
  constructor(
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly policy: ProblemEditPolicy,
    private readonly events: ProblemEvents,
    private readonly rateLimit: RateLimitService,
  ) {}

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
    if (problem.isFullMarkup && dto.description !== previous?.description)
      this.policy.assertFullMarkupWriter(principal);
    if (previous?.name === dto.name && previous.description === dto.description)
      return;
    await this.repository.upsertTranslation(problem._id, {
      language: lang,
      name: dto.name,
      description: dto.description,
      descriptionHtml: renderField(
        dto.description,
        styleOf(problem),
        'description',
      ),
    });
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: 'translation',
      userId: principal.userId,
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
    this.events.emit('statementChanged', problem._id);
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
