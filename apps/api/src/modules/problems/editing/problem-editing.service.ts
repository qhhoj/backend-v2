import { Injectable } from '@nestjs/common';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, unique, ValidationFailedError } from '@libs/common';
import { BASE_STATEMENT_LANGUAGE, uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { excerpt } from '@libs/community';
import { fieldDiff, ProblemDataFilesService } from '@libs/problems';
import { DiscordWebhooksService } from '../../discord/discord-webhooks.service';
import { chargedOrganization } from '../../organizations/quota/quota-charge';
import { QuotaService } from '../../organizations/quota/quota.service';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { LanguagesQuerier } from '../catalog/languages.querier';
import { ProblemEditPolicyService } from './problem-edit-policy.service';
import {
  toFields,
  withCodeTaken,
  withoutRenderedHtml,
} from './problem-edit-fields';
import { ProblemEvents } from '../core/problem.events';
import { renderField, styleOf } from './problem-markup';
import {
  ProblemsRepository,
  type ProblemDocument,
} from '../core/problems.repository';
import { ProblemsService } from '../core/problems.service';
import { RevisionsRepository } from '../core/revisions.repository';

/** What a submission or a user's points are worth depends on these (legacy rescored on each). */
const RESCORE_FIELDS = ['points', 'partial', 'isOrganizationPrivate'] as const;
/** Besides the statement text, the rendered PDF shows these. */
const PDF_INPUT_FIELDS = ['name', 'timeLimit', 'memoryLimit', 'languageLimits'];

type ProblemFields = ReturnType<typeof toFields>;
type ProblemChanges = ReturnType<typeof fieldDiff>;
interface ProblemEdit {
  original: ProblemDocument;
  updated: ProblemDocument;
  changes: ProblemChanges;
  isStatementRerendered: boolean;
}

/** Renders into `fields` (mutating it): the description when it or the markup mode changed, and every translation when the mode flipped; true when anything was rendered. */
function renderStatementsInto(
  fields: ProblemFields,
  original: ProblemDocument,
  translations: Problem['translations'],
): boolean {
  const isMarkupFlipped =
    fields.isFullMarkup !== undefined &&
    fields.isFullMarkup !== original.isFullMarkup;
  const isDescriptionChanged =
    fields.description !== undefined &&
    fields.description !== original.description;
  if (!isDescriptionChanged && !isMarkupFlipped) return false;
  const style = styleOf({
    isFullMarkup: fields.isFullMarkup ?? original.isFullMarkup,
  });
  fields.descriptionHtml = renderField(
    fields.description ?? original.description,
    style,
    'description',
  );
  if (isMarkupFlipped)
    fields.translations = translations.map((translation) => ({
      ...translation,
      descriptionHtml: renderField(
        translation.description,
        style,
        'translations',
      ),
    }));
  return true;
}

@Injectable()
export class ProblemEditingService {
  constructor(
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly problems: ProblemsService,
    private readonly policy: ProblemEditPolicyService,
    private readonly languages: LanguagesQuerier,
    private readonly events: ProblemEvents,
    private readonly dataFiles: ProblemDataFilesService,
    private readonly discord: DiscordWebhooksService,
    private readonly quota: QuotaService,
  ) {}

  async create(
    auth: AuthContext,
    dto: CreateProblemDto,
    mode: 'create' | 'suggest',
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const fields = toFields(dto);
    this.policy.assertCreateGates(principal, dto, fields);
    await this.policy.assertReferences(dto);
    // Validation is done: spend now, refund if the insert fails (a taken code included).
    const problem = await this.quota.charged(
      chargedOrganization(principal, fields),
      { kind: 'problem', userId: principal.userId, ref: dto.code },
      () => this.insert(principal, fields, mode),
    );
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: mode,
      userId: principal.userId,
      changes: fieldDiff({}, withoutRenderedHtml(problem.toJSON())),
      comment: 'Created on site',
    });
    if (mode === 'suggest' || problem.isOrganizationPrivate)
      await this.announce(problem, mode, principal.username);
    return this.problems.detail(
      principal,
      problem.code,
      BASE_STATEMENT_LANGUAGE,
    );
  }

  private insert(
    principal: Principal,
    fields: ProblemFields,
    mode: 'create' | 'suggest',
  ): Promise<ProblemDocument> {
    return withCodeTaken(() =>
      this.repository.create({
        ...fields,
        descriptionHtml: renderField(
          fields.description ?? '',
          styleOf({ isFullMarkup: fields.isFullMarkup ?? false }),
          'description',
        ),
        date: fields.date ?? new Date(),
        allowedLanguages:
          fields.allowedLanguages ??
          this.languages.includedInProblems().map((language) => language._id),
        ...(mode === 'suggest'
          ? { suggester: principal.userId, isPublic: false }
          : {
              curators: unique([...(fields.curators ?? []), principal.userId]),
            }),
      }),
    );
  }

  /** Legacy `on_new_problem` (organization problems) and `on_new_suggested_problem`. The author is the creator: the suggester in suggest mode, a curator otherwise (legacy: `suggester or authors.first()`). Legacy's trailing `Organizations:` line is omitted on purpose (less exposure). */
  private announce(
    problem: Problem,
    mode: 'create' | 'suggest',
    username: string,
  ): Promise<void> {
    const suggested = mode === 'suggest';
    const url = this.discord.link(`/problem/${problem.code}`);
    return this.discord.notify(
      suggested ? 'on_new_suggested_problem' : 'on_new_problem',
      {
        title: `New ${suggested ? 'suggested' : 'organization'} problem ${url}`,
        description: [
          `Title: ${problem.name}`,
          `Statement: ${excerpt(problem.description ?? '', 100)}...\n`,
          `Time limit: ${problem.timeLimit}`,
          `Memory limit (MB): ${problem.memoryLimit / 1024}`,
          `Points: ${problem.points}`,
        ].join('\n'),
        author: this.discord.author(username),
      },
    );
  }

  async edit(
    auth: AuthContext,
    code: string,
    dto: UpdateProblemDto,
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const original = await this.policy.editableProblem(principal, code);
    const originalJson = original.toJSON() as unknown as Record<
      string,
      unknown
    >;
    const fields = toFields(dto);
    this.policy.assertFieldGates(principal, dto, fields, originalJson);
    await this.policy.assertReferences(dto);
    await this.assertDataDirectoryFree(fields, original);
    const isStatementRerendered = renderStatementsInto(
      fields,
      original,
      originalJson.translations as Problem['translations'],
    );
    await withCodeTaken(() => this.repository.update(original._id, fields));
    const updated = await this.repository.findById(original._id);
    if (!updated) throw new AppError('not_found', 404, 'No such problem');
    const changes = fieldDiff(
      withoutRenderedHtml(originalJson),
      withoutRenderedHtml(updated.toJSON()),
    );
    if (Object.keys(changes).length)
      await this.recordRevisionAndEmitEvents(principal, {
        original,
        updated,
        changes,
        isStatementRerendered,
      });
    return this.problems.detail(
      principal,
      updated.code,
      BASE_STATEMENT_LANGUAGE,
    );
  }

  /** A rename must not adopt the leftover test data directory of a deleted problem. */
  private async assertDataDirectoryFree(
    fields: ProblemFields,
    original: ProblemDocument,
  ): Promise<void> {
    const newCode = fields.code;
    const isRename = newCode !== undefined && newCode !== original.code;
    if (isRename && (await this.dataFiles.exists(newCode)))
      throw new ValidationFailedError('Problem data directory is taken', [
        {
          field: 'code',
          code: 'data_directory_taken',
          message: 'A test data directory for this code already exists.',
        },
      ]);
  }

  private async recordRevisionAndEmitEvents(
    principal: Principal,
    edit: ProblemEdit,
  ): Promise<void> {
    await this.revisions.append({
      entity: 'problem',
      entityId: edit.original._id,
      action: 'edit',
      userId: principal.userId,
      changes: edit.changes,
      comment: 'Edited from site',
    });
    this.emitChangeEvents(edit);
  }

  /** In this order: rename, rescore, publicity, statement (the PDF shows the name and limits too). */
  private emitChangeEvents({
    original,
    updated,
    changes,
    isStatementRerendered,
  }: ProblemEdit): void {
    if ('code' in changes)
      this.events.emit('codeRenamed', original.code, updated.code);
    if (RESCORE_FIELDS.some((field) => field in changes))
      this.events.emit('pointsChanged', original._id);
    if ('isPublic' in changes)
      this.events.emit(
        'publicityChanged',
        original._id,
        updated.suggester === null ? null : uuidStr(updated.suggester),
      );
    if (
      isStatementRerendered ||
      PDF_INPUT_FIELDS.some((field) => field in changes)
    )
      this.events.emit('statementChanged', original._id);
  }
}
