import { Injectable } from '@nestjs/common';
import { hasPermission } from '@libs/auth';
import type { AuthContext, Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import { BASE_STATEMENT_LANGUAGE, uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { fieldDiff, ProblemDataFilesService } from '@libs/problems';
import { DiscordWebhooksService } from '@libs/community';
import {
  chargedOrganization,
  newlyChargedOrganization,
} from '../../organizations/quota/quota-charge';
import { QuotaService } from '../../organizations/quota/quota.service';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
import { ProblemDetailResponse } from '../core/dto/problem-detail.response';
import { LanguagesQuerier } from '../catalog/languages.querier';
import type { CreationTarget } from '../../organizations/creation/organization-creation-rights.service';
import { assertOrganizationCodePrefix } from './organization-code-prefix';
import { OrganizationProblemRules } from './organization-problem-rules.service';
import { ProblemEditPolicyService } from './problem-edit-policy.service';
import {
  assertNoDataDirectory,
  toFields,
  withCodeTaken,
  withoutRenderedHtml,
} from './problem-edit-fields';
import { ProblemEvents } from '../core/problem.events';
import { problemChargeSubject } from '../quota/problem-charge-subject';
import { ProblemStorageQuota } from '../quota/problem-storage-quota.service';
import { renderField, styleOf } from './problem-markup';
import {
  ProblemsRepository,
  type ProblemDocument,
} from '../core/problems.repository';
import { ProblemsService } from '../core/problems.service';
import { RevisionsRepository } from '../core/revisions.repository';

/** What a submission or a user's points are worth depends on these (legacy rescored on each). */
const RESCORE_FIELDS = ['points', 'partial', 'isOrganizationPrivate'] as const;
/** Revision comment when the edit carries no `changeMessage`. */
const DEFAULT_EDIT_COMMENT = 'Edited from site';
/** Besides the statement text, the rendered PDF shows these. */
const PDF_INPUT_FIELDS = ['name', 'timeLimit', 'memoryLimit', 'languageLimits'];

type ProblemFields = ReturnType<typeof toFields>;
type ProblemChanges = ReturnType<typeof fieldDiff>;
/** What `applyEdit` wrote: the stored problem, and whether any field changed (no change writes no revision). */
export interface EditOutcome {
  updated: ProblemDocument;
  isChanged: boolean;
}
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
    private readonly organizationRules: OrganizationProblemRules,
    private readonly storage: ProblemStorageQuota,
  ) {}

  /** `organization`: an organization create (`POST /organizations/:slug/problems`), which sets the organization fields itself and needs the code prefix. */
  async create(
    auth: AuthContext,
    dto: CreateProblemDto,
    mode: 'create' | 'suggest',
    organization: CreationTarget | null = null,
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const fields = toFields(dto);
    if (organization) {
      assertOrganizationCodePrefix(
        principal,
        dto.code,
        organization.codePrefix,
      );
      fields.organizations = [organization.id];
      fields.isOrganizationPrivate = true;
    }
    this.policy.assertCreateGates(principal, dto, fields, organization);
    await this.policy.assertReferences(dto);
    await assertNoDataDirectory(this.dataFiles, dto.code);
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
      await this.discord.announceNewProblem(problem, mode, principal.username);
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

  async edit(
    auth: AuthContext,
    code: string,
    dto: UpdateProblemDto,
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const { updated } = await this.applyEdit(principal, code, dto);
    return this.problems.detail(
      principal,
      updated.code,
      BASE_STATEMENT_LANGUAGE,
    );
  }

  /** The whole PATCH except the response: gates, write, revision (`changeMessage` as its comment) and change events. */
  async applyEdit(
    principal: Principal,
    code: string,
    dto: UpdateProblemDto,
  ): Promise<EditOutcome> {
    const { changeMessage, ...problemDto } = dto;
    const original = await this.policy.editableProblem(principal, code);
    const originalJson = original.toJSON() as unknown as Record<
      string,
      unknown
    >;
    const fields = toFields(problemDto);
    const waived = await this.organizationRules.forEdit(
      principal,
      original,
      fields,
    );
    this.policy.assertFieldGates(principal, problemDto, fields, {
      baseline: originalJson,
      waived,
    });
    await this.policy.assertReferences(problemDto);
    await this.assertDataDirectoryFree(fields, original);
    const isStatementRerendered = renderStatementsInto(
      fields,
      original,
      originalJson.translations as Problem['translations'],
    );
    await this.saveCharged(principal, original, fields);
    const updated = await this.repository.findById(original._id);
    if (!updated) throw new AppError('not_found', 404, 'No such problem');
    const changes = fieldDiff(
      withoutRenderedHtml(originalJson),
      withoutRenderedHtml(updated.toJSON()),
    );
    const isChanged = Object.keys(changes).length > 0;
    if (isChanged)
      await this.recordRevisionAndEmitEvents(
        principal,
        { original, updated, changes, isStatementRerendered },
        changeMessage?.trim() || DEFAULT_EDIT_COMMENT,
      );
    return { updated, isChanged };
  }

  /** A move into an organization (see `newlyChargedOrganization`) pays the problem credit like a create, refunded when the save fails; a new charged organization must fit the problem's bytes. */
  private async saveCharged(
    principal: Principal,
    original: ProblemDocument,
    fields: ProblemFields,
  ): Promise<void> {
    await this.storage.assertMoveFits(principal, original, fields);
    const charged = newlyChargedOrganization(
      principal,
      problemChargeSubject(original),
      fields,
    );
    await this.quota.charged(
      charged,
      { kind: 'problem', userId: principal.userId, ref: original.code },
      () =>
        withCodeTaken(() => this.guardedUpdate(principal, original, fields)),
    );
  }

  /**
   * Without `judge.change_public_visibility`, an edit of a visibility flag saves only while both are as its gates
   * read them, so two concurrent edits cannot combine into a site publish neither may make alone (a members-only
   * `isPublic` and a privacy flip); the loser gets a 409 and its charge is refunded. A holder may publish anyway, so
   * their edits (contest publish, bulk visibility) never conflict.
   */
  private async guardedUpdate(
    principal: Principal,
    original: ProblemDocument,
    fields: ProblemFields,
  ): Promise<void> {
    const isGuarded =
      (fields.isPublic !== undefined ||
        fields.isOrganizationPrivate !== undefined) &&
      !hasPermission(principal, 'judge.change_public_visibility');
    // False also matches a legacy row without the field (the document reads the schema default).
    const flagIs = (value: boolean) => (value ? true : { $ne: true });
    const guard = isGuarded
      ? {
          isPublic: flagIs(original.isPublic),
          isOrganizationPrivate: flagIs(original.isOrganizationPrivate),
        }
      : {};
    const isSaved = await this.repository.update(original._id, fields, guard);
    if (!isSaved && isGuarded)
      throw new AppError(
        'conflict',
        409,
        'The problem changed meanwhile; reload and save again',
      );
  }

  /** A rename must not adopt the leftover test data directory of a deleted problem. */
  private async assertDataDirectoryFree(
    fields: ProblemFields,
    original: ProblemDocument,
  ): Promise<void> {
    const newCode = fields.code;
    if (newCode !== undefined && newCode !== original.code)
      await assertNoDataDirectory(this.dataFiles, newCode);
  }

  private async recordRevisionAndEmitEvents(
    principal: Principal,
    edit: ProblemEdit,
    comment: string,
  ): Promise<void> {
    await this.revisions.append({
      entity: 'problem',
      entityId: edit.original._id,
      action: 'edit',
      userId: principal.userId,
      changes: edit.changes,
      comment,
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
