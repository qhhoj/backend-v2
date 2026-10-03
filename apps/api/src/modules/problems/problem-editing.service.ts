import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { AuthContext, Permission, Principal } from '@libs/auth';
import { AppError, isDuplicateKey, RateLimitService } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Problem, StatementLanguage } from '@libs/database';
import { renderMarkdown } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import { CloneProblemDto } from './dto/clone.dto';
import { PutEditorialDto } from './dto/editorial.dto';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
import { RenderPreviewDto } from './dto/render-preview.dto';
import { PutTranslationDto } from './dto/translation.dto';
import { ProblemDetailResponse } from './dto/problem-detail.response';
import { fieldDiff } from './field-diff';
import { LanguagesQuerier } from './languages.querier';
import { LicensesQuerier } from './licenses.querier';
import { ProblemAccess } from './problem-access';
import { ProblemEvents } from './problem.events';
import { ProblemGroupsQuerier } from './problem-groups.querier';
import { ProblemTypesQuerier } from './problem-types.querier';
import { ProblemsRepository } from './problems.repository';
import type { ProblemDocument } from './problems.repository';
import { ProblemsService } from './problems.service';
import {
  RENDER_PREVIEW_LIMIT,
  RENDER_PREVIEW_WINDOW_SECONDS,
} from './rate-limits';
import { RevisionsRepository } from './revisions.repository';

const TIME_LIMIT_WITHOUT_PERMISSION = 5;
const GATED_FIELDS: ReadonlyArray<[keyof CreateProblemDto, Permission]> = [
  ['isPublic', 'judge.change_public_visibility'],
  ['isManuallyManaged', 'judge.change_manually_managed'],
  ['isFullMarkup', 'judge.problem_full_markup'],
];
/** Django-admin-only in legacy. */
const STAFF_FIELDS: ReadonlyArray<keyof CreateProblemDto> = [
  'authors',
  'curators',
  'bannedUsers',
  'licenseId',
  'summary',
  'ogImage',
  'allowedLanguages',
  'organizations',
  'isOrganizationPrivate',
  'testcaseResultVisibility',
  'allowViewFeedback',
  'date',
];
/** Stored values of a new problem, to tell which gated fields a create request changes. */
const CREATE_BASELINE: Partial<Record<keyof CreateProblemDto, unknown>> = {
  isPublic: false,
  isManuallyManaged: false,
  isFullMarkup: false,
  authors: [],
  curators: [],
  bannedUsers: [],
  licenseId: null,
  summary: '',
  ogImage: '',
  organizations: [],
  isOrganizationPrivate: false,
  testcaseResultVisibility: 'A',
  allowViewFeedback: false,
};
/** The only field a request may set to null (it clears the license). */
const NULLABLE_FIELDS: ReadonlyArray<keyof CreateProblemDto> = ['licenseId'];
const unique = (ids: string[]) => [...new Set(ids)];
/** Id and limit lists are sets: order never counts as a change. */
const comparable = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => JSON.stringify(item)).sort()
    : value;
/** Revisions keep the editable source, never the rendered HTML. */
const withoutRenderedHtml = (
  problem: Record<string, unknown>,
): Record<string, unknown> => ({
  ...problem,
  translations: (
    problem.translations as Problem['translations'] | undefined
  )?.map(({ language, name, description }) => ({
    language,
    name,
    description,
  })),
});
/** Never carried over by a clone: identity, timestamps, people, statement translations, editorial and mirror links. */
export const CLONE_RESET_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'code',
  'isPublic',
  'date',
  'userCount',
  'acRate',
  'authors',
  'curators',
  'testers',
  'bannedUsers',
  'suggester',
  'translations',
  'solution',
  'mirrorOf',
  'mirrorRoot',
];
/** Copied by value; together with CLONE_RESET_FIELDS this must cover every schema path. */
export const CLONE_COPIED_FIELDS = [
  'name',
  'source',
  'summary',
  'description',
  'descriptionHtml',
  'timeLimit',
  'memoryLimit',
  'points',
  'partial',
  'isOrganizationPrivate',
  'organizations',
  'isManuallyManaged',
  'isFullMarkup',
  'typeIds',
  'groupId',
  'licenseId',
  'allowedLanguages',
  'languageLimits',
  'pdfStatementUrl',
  'materialUrl',
  'ogImage',
  'submissionSourceVisibility',
  'testcaseVisibility',
  'testcaseResultVisibility',
  'allowViewFeedback',
];
const ID_ARRAY_FIELDS: ReadonlyArray<keyof CreateProblemDto> = [
  'typeIds',
  'authors',
  'curators',
  'testers',
  'bannedUsers',
  'allowedLanguages',
];
const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

@Injectable()
export class ProblemEditingService {
  constructor(
    private readonly repository: ProblemsRepository,
    private readonly revisions: RevisionsRepository,
    private readonly problems: ProblemsService,
    private readonly users: UsersRepository,
    private readonly types: ProblemTypesQuerier,
    private readonly groups: ProblemGroupsQuerier,
    private readonly licenses: LicensesQuerier,
    private readonly languages: LanguagesQuerier,
    private readonly events: ProblemEvents,
    private readonly rateLimit: RateLimitService,
  ) {}

  async create(
    auth: AuthContext,
    dto: CreateProblemDto,
    mode: 'create' | 'suggest',
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const fields = this.toFields(dto);
    this.assertFieldGates(principal, dto, fields, CREATE_BASELINE);
    await this.assertReferences(dto);
    const problem = await this.createUnique({
      ...fields,
      descriptionHtml: renderMarkdown(
        fields.description ?? '',
        this.styleOf({ isFullMarkup: fields.isFullMarkup ?? false }),
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
    });
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: mode,
      userId: principal.userId,
      changes: fieldDiff({}, withoutRenderedHtml(problem.toJSON())),
      comment: 'Created on site',
    });
    return this.problems.detail(principal, problem.code, 'en');
  }

  async edit(
    auth: AuthContext,
    code: string,
    dto: UpdateProblemDto,
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    const problem = await this.editableProblem(principal, code);
    const before = problem.toJSON() as unknown as Record<string, unknown>;
    const fields = this.toFields(dto);
    this.assertFieldGates(principal, dto, fields, before);
    await this.assertReferences(dto);
    const markupFlipped =
      fields.isFullMarkup !== undefined &&
      fields.isFullMarkup !== problem.isFullMarkup;
    const descriptionChanged =
      fields.description !== undefined &&
      fields.description !== problem.description;
    if (descriptionChanged || markupFlipped) {
      const style = this.styleOf({
        isFullMarkup: fields.isFullMarkup ?? problem.isFullMarkup,
      });
      fields.descriptionHtml = renderMarkdown(
        fields.description ?? problem.description,
        style,
      );
      if (markupFlipped)
        fields.translations = (
          before.translations as Problem['translations']
        ).map((translation) => ({
          ...translation,
          descriptionHtml: renderMarkdown(translation.description, style),
        }));
    }
    await this.updateUnique(problem._id, fields);
    const updated = await this.repository.findById(problem._id);
    if (!updated) throw new AppError('not_found', 404, 'No such problem');
    const changes = fieldDiff(
      withoutRenderedHtml(before),
      withoutRenderedHtml(updated.toJSON()),
    );
    if (!Object.keys(changes).length)
      return this.problems.detail(principal, updated.code, 'en');
    await this.revisions.append({
      entity: 'problem',
      entityId: problem._id,
      action: 'edit',
      userId: principal.userId,
      changes,
      comment: 'Edited from site',
    });
    if ('code' in changes)
      this.events.emit('codeRenamed', problem.code, updated.code);
    if ('points' in changes) this.events.emit('pointsChanged', problem._id);
    if ('isPublic' in changes)
      this.events.emit(
        'publicityChanged',
        problem._id,
        updated.suggester === null ? null : uuidStr(updated.suggester),
      );
    if (descriptionChanged || markupFlipped)
      this.events.emit('statementChanged', problem._id);
    return this.problems.detail(principal, updated.code, 'en');
  }

  async putTranslation(
    auth: AuthContext,
    code: string,
    lang: StatementLanguage,
    dto: PutTranslationDto,
  ): Promise<void> {
    const { principal } = auth;
    const problem = await this.editableProblem(principal, code);
    const previous = problem.translations.find(
      (translation) => translation.language === lang,
    );
    if (problem.isFullMarkup && dto.description !== previous?.description)
      this.assertFullMarkupWriter(principal);
    if (previous?.name === dto.name && previous.description === dto.description)
      return;
    await this.repository.upsertTranslation(problem._id, {
      language: lang,
      name: dto.name,
      description: dto.description,
      descriptionHtml: renderMarkdown(dto.description, this.styleOf(problem)),
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
    const problem = await this.editableProblem(auth.principal, code);
    await this.assertReferences({ authors: dto.authors });
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
        contentHtml: renderMarkdown(dto.content, 'solution'),
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

  async clone(
    auth: AuthContext,
    code: string,
    dto: CloneProblemDto,
  ): Promise<ProblemDetailResponse> {
    const source = await this.editableProblem(auth.principal, code);
    const copied = Object.fromEntries(
      Object.entries(source.toJSON()).filter(([field]) =>
        CLONE_COPIED_FIELDS.includes(field),
      ),
    ) as Partial<Problem>;
    const clone = await this.createUnique({
      ...copied,
      code: dto.code,
      date: new Date(),
      curators: [auth.principal.userId],
    });
    await this.revisions.append({
      entity: 'problem',
      entityId: clone._id,
      action: 'clone',
      userId: auth.principal.userId,
      changes: fieldDiff({}, withoutRenderedHtml(clone.toJSON())),
      comment: `Cloned problem from ${code}`,
    });
    return this.problems.detail(auth.principal, clone.code, 'en');
  }

  async preview(
    auth: AuthContext,
    dto: RenderPreviewDto,
  ): Promise<{ html: string }> {
    if (dto.style === 'problem-full')
      this.assertFullMarkupWriter(auth.principal);
    await this.rateLimit.reserve(
      [`render-preview:user:${auth.principal.userId}`],
      RENDER_PREVIEW_LIMIT,
      RENDER_PREVIEW_WINDOW_SECONDS,
    );
    return { html: renderMarkdown(dto.markdown, dto.style) };
  }

  /** 404 when invisible (never leaks), 403 when visible but not editable. */
  async editableProblem(
    principal: Principal,
    code: string,
  ): Promise<ProblemDocument> {
    const problem = await this.problems.visibleProblem(principal, code);
    if (!ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem)))
      throw new AppError(
        'forbidden',
        403,
        'You are not allowed to edit this problem',
      );
    return problem;
  }

  /** The one place that maps a problem to its statement render style. */
  styleOf(problem: Pick<Problem, 'isFullMarkup'>): RenderStyle {
    return problem.isFullMarkup ? 'problem-full' : 'problem';
  }

  /** A gate fires only when the request changes the value (compared with the stored document, or the defaults on create). */
  private assertFieldGates(
    principal: Principal,
    dto: UpdateProblemDto,
    fields: Partial<Problem>,
    baseline: Record<string, unknown>,
  ): void {
    const normalized = fields as Record<string, unknown>;
    const changes = (field: keyof CreateProblemDto) =>
      normalized[field] !== undefined &&
      !sameJson(comparable(normalized[field]), comparable(baseline[field]));
    for (const [field, permission] of GATED_FIELDS)
      if (changes(field) && !hasPermission(principal, permission))
        throw new AppError(
          'forbidden',
          403,
          `Changing ${field} requires ${permission}`,
        );
    const isFullMarkup = fields.isFullMarkup ?? baseline.isFullMarkup;
    if (isFullMarkup && changes('description'))
      this.assertFullMarkupWriter(principal);
    const staffChanges = STAFF_FIELDS.filter(changes);
    if (
      staffChanges.length &&
      !hasPermission(principal, 'judge.edit_all_problem')
    )
      throw new AppError(
        'forbidden',
        403,
        `Changing ${staffChanges.join(', ')} requires judge.edit_all_problem`,
      );
    const limits = [
      dto.timeLimit,
      ...(dto.languageLimits ?? []).map((limit) => limit.timeLimit),
    ];
    if (
      limits.some(
        (limit) => limit !== undefined && limit > TIME_LIMIT_WITHOUT_PERMISSION,
      ) &&
      !hasPermission(principal, 'judge.high_problem_timelimit')
    )
      throw new AppError('validation_failed', 400, 'Time limit too high', {
        timeLimit: [
          `You cannot set time limit higher than ${TIME_LIMIT_WITHOUT_PERMISSION} seconds`,
        ],
      });
  }

  /** Unsanitized HTML (`problem-full`) is writable only with this permission. */
  private assertFullMarkupWriter(principal: Principal): void {
    if (!hasPermission(principal, 'judge.problem_full_markup'))
      throw new AppError(
        'forbidden',
        403,
        'Full markup requires judge.problem_full_markup',
      );
  }

  /** Every referenced catalog row and user must exist; `organizations` are unchecked until sub-project 5. */
  private async assertReferences(dto: UpdateProblemDto): Promise<void> {
    const fields: Record<string, string[]> = {};
    const missing = (
      ids: string[] | undefined,
      exists: (id: string) => boolean,
    ) => (ids ?? []).filter((id) => !exists(id));
    if (missing(dto.typeIds, (id) => this.types.has(id)).length)
      fields.typeIds = ['Unknown problem type.'];
    if (dto.groupId !== undefined && !this.groups.has(dto.groupId))
      fields.groupId = ['Unknown problem group.'];
    if (dto.licenseId && !this.licenses.has(dto.licenseId))
      fields.licenseId = ['Unknown license.'];
    if (missing(dto.allowedLanguages, (id) => this.languages.has(id)).length)
      fields.allowedLanguages = ['Unknown language.'];
    const limitLanguages = (dto.languageLimits ?? []).map(
      (limit) => limit.languageId,
    );
    if (
      missing(limitLanguages, (id) => this.languages.has(id)).length ||
      unique(limitLanguages).length !== limitLanguages.length
    )
      fields.languageLimits = ['Each language may appear once and must exist.'];
    const userFields = [
      'authors',
      'curators',
      'testers',
      'bannedUsers',
    ] as const;
    const userIds = unique(userFields.flatMap((field) => dto[field] ?? []));
    const known = new Set(
      (await this.users.findByIds(userIds)).map((user) => user._id),
    );
    for (const field of userFields)
      if (missing(dto[field], (id) => known.has(id)).length)
        fields[field] = ['Unknown user.'];
    if (Object.keys(fields).length)
      throw new AppError(
        'validation_failed',
        400,
        'Invalid references',
        fields,
      );
  }

  /** DTO → document fields (`date` string → Date); unsent fields and nulls (except where legal) are left out, since `update()` runs no validators. */
  private toFields(dto: UpdateProblemDto): Partial<Problem> {
    const { date, ...rest } = dto;
    const fields = Object.fromEntries(
      Object.entries(rest).filter(
        ([field, value]) =>
          value !== undefined &&
          (value !== null ||
            NULLABLE_FIELDS.includes(field as keyof CreateProblemDto)),
      ),
    ) as Partial<Problem>;
    const record = fields as Record<string, unknown>;
    for (const field of ID_ARRAY_FIELDS) {
      const ids = record[field];
      if (Array.isArray(ids)) record[field] = unique(ids as string[]);
    }
    if (date) fields.date = new Date(date);
    return fields;
  }

  private async createUnique(
    fields: Partial<Problem>,
  ): Promise<ProblemDocument> {
    try {
      return await this.repository.create(fields);
    } catch (error) {
      throw this.codeTaken(error);
    }
  }

  private async updateUnique(
    id: string,
    fields: Partial<Problem>,
  ): Promise<void> {
    try {
      await this.repository.update(id, fields);
    } catch (error) {
      throw this.codeTaken(error);
    }
  }

  private codeTaken(error: unknown): unknown {
    return isDuplicateKey(error, 'code')
      ? new AppError('validation_failed', 400, 'Problem code is taken', {
          code: ['Problem code is taken.'],
        })
      : error;
  }
}
