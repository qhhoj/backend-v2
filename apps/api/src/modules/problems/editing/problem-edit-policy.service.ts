import { Injectable } from '@nestjs/common';
import { hasPermission, UsersRepository } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
import { AppError, sameJson, unique } from '@libs/common';
import type { Problem } from '@libs/database';
import type {
  CreateProblemDto,
  UpdateProblemDto,
} from './dto/problem-edit.dto';
import { LanguagesQuerier } from '../catalog/languages.querier';
import { LicensesQuerier } from '../catalog/licenses.querier';
import { comparable } from './problem-edit-fields';
import { ProblemAccess } from '../core/problem-access';
import { ProblemGroupsQuerier } from '../catalog/problem-groups.querier';
import { ProblemTypesQuerier } from '../catalog/problem-types.querier';
import type { ProblemDocument } from '../core/problems.repository';
import { ProblemsService } from '../core/problems.service';

const TIME_LIMIT_WITHOUT_PERMISSION_SECONDS = 5;
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

/** Who may edit a problem and which fields and references a request may set. */
@Injectable()
export class ProblemEditPolicyService {
  constructor(
    private readonly problems: ProblemsService,
    private readonly users: UsersRepository,
    private readonly types: ProblemTypesQuerier,
    private readonly groups: ProblemGroupsQuerier,
    private readonly licenses: LicensesQuerier,
    private readonly languages: LanguagesQuerier,
  ) {}

  /** 404 when invisible (never leaks), 403 when visible but not editable. */
  async editableProblem(
    principal: Principal,
    code: string,
  ): Promise<ProblemDocument> {
    const problem = await this.problems.visibleProblemOutsideContest(
      principal,
      code,
    );
    if (!ProblemAccess.canEdit(principal, ProblemAccess.accessView(problem)))
      throw new AppError(
        'forbidden',
        403,
        'You are not allowed to edit this problem',
      );
    return problem;
  }

  assertCreateGates(
    principal: Principal,
    dto: CreateProblemDto,
    fields: Partial<Problem>,
  ): void {
    this.assertFieldGates(principal, dto, fields, CREATE_BASELINE);
  }

  /** A gate fires only when the request changes the value (compared with the stored document, or the defaults on create). */
  assertFieldGates(
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
        (limit) =>
          limit !== undefined && limit > TIME_LIMIT_WITHOUT_PERMISSION_SECONDS,
      ) &&
      !hasPermission(principal, 'judge.high_problem_timelimit')
    )
      throw new AppError('validation_failed', 400, 'Time limit too high', {
        timeLimit: [
          `You cannot set time limit higher than ${TIME_LIMIT_WITHOUT_PERMISSION_SECONDS} seconds`,
        ],
      });
  }

  /** Unsanitized HTML (`problem-full`) is writable only with this permission. */
  assertFullMarkupWriter(principal: Principal): void {
    if (!hasPermission(principal, 'judge.problem_full_markup'))
      throw new AppError(
        'forbidden',
        403,
        'Full markup requires judge.problem_full_markup',
      );
  }

  /** Every referenced catalog row and user must exist; `organizations` are unchecked until sub-project 5. */
  async assertReferences(dto: UpdateProblemDto): Promise<void> {
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
}
