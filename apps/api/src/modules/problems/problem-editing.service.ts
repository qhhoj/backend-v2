import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { AuthContext, Permission, Principal } from '@libs/auth';
import { AppError, isDuplicateKey } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Problem } from '@libs/database';
import { renderMarkdown } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import { CreateProblemDto, UpdateProblemDto } from './dto/problem-edit.dto';
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
  ) {}

  async create(
    auth: AuthContext,
    dto: CreateProblemDto,
    mode: 'create' | 'suggest',
  ): Promise<ProblemDetailResponse> {
    const { principal } = auth;
    this.assertFieldGates(principal, dto, CREATE_BASELINE);
    await this.assertReferences(dto);
    const fields = this.toFields(dto);
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
      changes: fieldDiff({}, problem.toJSON()),
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
    this.assertFieldGates(principal, dto, before);
    await this.assertReferences(dto);
    const fields = this.toFields(dto);
    const isFullMarkup = fields.isFullMarkup ?? problem.isFullMarkup;
    const statementChanged =
      fields.description !== undefined || isFullMarkup !== problem.isFullMarkup;
    if (statementChanged) {
      const style = this.styleOf({ isFullMarkup });
      fields.descriptionHtml = renderMarkdown(
        fields.description ?? problem.description,
        style,
      );
      fields.translations = (
        before.translations as Problem['translations']
      ).map((translation) => ({
        ...translation,
        descriptionHtml: renderMarkdown(translation.description, style),
      }));
    }
    await this.updateUnique(problem._id, fields);
    const updated = (await this.repository.findById(problem._id))!;
    const changes = fieldDiff(before, updated.toJSON());
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
    if (statementChanged) this.events.emit('statementChanged', problem._id);
    return this.problems.detail(principal, updated.code, 'en');
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
    baseline: Record<string, unknown>,
  ): void {
    const normalized = this.toFields(dto) as Record<string, unknown>;
    const changes = (field: keyof CreateProblemDto) =>
      normalized[field] !== undefined &&
      !sameJson(normalized[field], baseline[field]);
    for (const [field, permission] of GATED_FIELDS)
      if (changes(field) && !hasPermission(principal, permission))
        throw new AppError(
          'forbidden',
          403,
          `Changing ${field} requires ${permission}`,
        );
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
