import { Injectable } from '@nestjs/common';
import { hasPermission, sha256, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, unique } from '@libs/common';
import { FormatConfigError, parseFormatConfig } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest, ContestProblem } from '@libs/database';
import { renderMarkdown, RenderLimitError } from '@libs/render';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import {
  ORGANIZATION_RIGHTS_ISSUE,
  organizationsToAuthorize,
} from '../../problems/editing/organization-move';
import { OrganizationCreationRights } from '../../organizations/creation/organization-creation-rights.service';
import { ContestTagsQuerier } from '../tags/contest-tags.querier';
import type { ContestDocument } from '../core/contests.repository';
import { NULLABLE_CONTEST_FIELDS } from './dto/contest-edit.dto';
import type {
  ContestProblemDto,
  UpdateContestDto,
} from './dto/contest-edit.dto';
import {
  assertGates,
  assertWindow,
  CREATE_BASELINE,
} from './contest-edit-rules';

const USER_FIELDS = [
  'authors',
  'curators',
  'testers',
  'privateContestants',
  'bannedUsers',
  'viewContestScoreboard',
  'balloonStaff',
  'rateExclude',
] as const;

const DATE_FIELDS = [
  'startTime',
  'endTime',
  'registrationStart',
  'registrationEnd',
  'lockedAfter',
] as const;

function assertNoForbiddenNulls(dto: UpdateContestDto): void {
  for (const [field, value] of Object.entries(dto))
    if (
      value === null &&
      !NULLABLE_CONTEST_FIELDS.includes(field as keyof UpdateContestDto)
    )
      throw invalidField(field, `${field} cannot be null.`);
}

/** Only the dates the request sent; null clears one. */
function datesOf(
  requested: Partial<Record<(typeof DATE_FIELDS)[number], string | null>>,
): Partial<Contest> {
  const dates: Partial<Contest> = {};
  for (const field of DATE_FIELDS) {
    const value = requested[field];
    if (value !== undefined)
      Object.assign(dates, {
        [field]: value === null ? null : new Date(value),
      });
  }
  return dates;
}

/** Request fields that are stored under another name, converted, or looked up first. */
const NOT_STORED_AS_SENT: ReadonlyArray<string> = [
  ...DATE_FIELDS,
  'accessCode',
  'rankingAccessCode',
  'problems',
  'formatConfig',
];

/** The request's plain fields, its dates and its code hashes; nothing that needs a lookup. */
function fieldsWithoutLookups(dto: UpdateContestDto): Partial<Contest> {
  const plain = Object.entries(dto).filter(
    ([field]) => !NOT_STORED_AS_SENT.includes(field),
  );
  return {
    ...Object.fromEntries(plain),
    ...datesOf(dto),
    ...accessCodeHashes(dto),
  };
}

const hashOrNull = (code: string): string | null =>
  code ? sha256(code) : null;

/** Plaintext codes are never stored; an empty code clears the hash. */
function accessCodeHashes({
  accessCode,
  rankingAccessCode,
}: Pick<
  UpdateContestDto,
  'accessCode' | 'rankingAccessCode'
>): Partial<Contest> {
  return {
    ...(accessCode === undefined
      ? {}
      : { accessCodeHash: hashOrNull(accessCode) }),
    ...(rankingAccessCode === undefined
      ? {}
      : { rankingAccessCodeHash: hashOrNull(rankingAccessCode) }),
  };
}

/** The request's config, else the stored one while the format stays, else the new format's defaults. */
function resolveFormatConfig(
  dto: UpdateContestDto,
  current: ContestDocument | null,
): Contest['formatConfig'] {
  const formatName = dto.formatName ?? current?.formatName ?? 'default';
  const storedConfig =
    formatName === current?.formatName ? current.formatConfig : null;
  const rawConfig =
    dto.formatConfig !== undefined ? dto.formatConfig : storedConfig;
  try {
    return parseFormatConfig(formatName, rawConfig);
  } catch (error) {
    if (!(error instanceof FormatConfigError)) throw error;
    throw invalidField('formatConfig', `${formatName}: ${error.message}`);
  }
}

/** Markdown to sanitised HTML; text past the render limits is the field's validation error. */
function renderField(field: 'description' | 'rules', text: string): string {
  try {
    return renderMarkdown(text, 'problem');
  } catch (error) {
    if (!(error instanceof RenderLimitError)) throw error;
    throw invalidField(field, error.message);
  }
}

/** The trimmed text and its HTML (revision 1 on create); on an edit the revision is raised by the update itself (`ContestsRepository.updateRules`), so concurrent saves cannot write the same one. Nothing but the text when it is unchanged. */
function rulesFields(
  dto: UpdateContestDto,
  current: ContestDocument | null,
): Partial<Contest> {
  if (dto.rules === undefined) return {};
  const text = dto.rules.trim();
  if (text === (current?.rules ?? '')) return { rules: text };
  return {
    rules: text,
    rulesHtml: text ? renderField('rules', text) : '',
    ...(current ? {} : { rulesRevision: 1 }),
  };
}

/** Who switched auto-publishing on is re-checked when the job runs, so the switch itself needs no extra permission; sending the current value changes nothing. */
function publishFields(
  principal: Principal,
  dto: UpdateContestDto,
  current: ContestDocument | null,
): Partial<Contest> {
  if (
    dto.publishAfterEnd === undefined ||
    dto.publishAfterEnd === (current?.publishAfterEnd ?? false)
  )
    return {};
  return dto.publishAfterEnd
    ? { publishAfterEndBy: principal.userId, autoPublishOutcome: null }
    : { publishAfterEndBy: null };
}

/** One `unknown_tag` 400 with an issue per slug, so each carries its own code. */
function unknownTags(slugs: string[]): AppError {
  const messages = slugs.map((slug) => `Unknown tag ${slug}.`);
  return new AppError(
    'unknown_tag',
    400,
    `Unknown tag: ${slugs.join(', ')}`,
    { tags: messages },
    undefined,
    {
      issues: slugs.map((slug, index) => ({
        field: 'tags',
        code: 'unknown_tag',
        message: messages[index],
      })),
    },
  );
}

@Injectable()
export class ContestEditFieldsService {
  constructor(
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
    private readonly tags: ContestTagsQuerier,
    private readonly rights: OrganizationCreationRights,
  ) {}

  /** The DTO as stored fields, checked against `current` (null on create). */
  async toFields(
    principal: Principal,
    dto: UpdateContestDto,
    current: ContestDocument | null,
  ): Promise<Partial<Contest>> {
    assertNoForbiddenNulls(dto);
    const fields = fieldsWithoutLookups(dto);
    if (dto.problems !== undefined)
      fields.problems = await this.contestProblems(principal, dto.problems);
    if (dto.description !== undefined)
      fields.descriptionHtml = renderField('description', dto.description);
    Object.assign(fields, rulesFields(dto, current));
    Object.assign(fields, publishFields(principal, dto, current));
    this.assertTags(dto, current);
    const isFormatEdited =
      dto.formatConfig !== undefined || dto.formatName !== undefined;
    // Relies on the schema's `formatConfig` default only for the no-format create; any edit of the format resolves it here.
    if (!current || isFormatEdited)
      fields.formatConfig = resolveFormatConfig(dto, current);
    const merged = { ...(current?.toObject() ?? {}), ...fields } as Contest;
    assertWindow(principal, merged);
    assertGates(
      principal,
      fields,
      current ? current.toJSON() : CREATE_BASELINE,
      merged,
    );
    await this.assertOrganizationRights(principal, fields, current);
    await this.assertUsers(fields);
    return fields;
  }

  /** Only slugs added to the stored set need a catalogue entry: an old contest with a legacy slug still saves, and a legacy slug can always be removed. */
  private assertTags(
    dto: UpdateContestDto,
    current: ContestDocument | null,
  ): void {
    if (dto.tags === undefined) return;
    const stored = current?.tags ?? [];
    const unknown = dto.tags.filter(
      (slug) => !stored.includes(slug) && !this.tags.hasSlug(slug),
    );
    if (unknown.length) throw unknownTags(unknown);
  }

  /**
   * An editor without `judge.edit_all_contest` adds, removes or flips only organizations they may create contests for
   * (the organization creation rule, as for problems): an organization administrator never moves a contest into another
   * organization. 403 with `organization_rights` on `organizations` otherwise.
   */
  private async assertOrganizationRights(
    principal: Principal,
    fields: Partial<Contest>,
    current: ContestDocument | null,
  ): Promise<void> {
    if (
      (fields.organizations === undefined &&
        fields.isOrganizationPrivate === undefined) ||
      hasPermission(principal, 'judge.edit_all_contest')
    )
      return;
    const before = {
      organizations: (current?.organizations ?? []).map(uuidStr),
      isOrganizationPrivate: current?.isOrganizationPrivate ?? false,
    };
    const after = {
      organizations: (fields.organizations ?? before.organizations).map(
        uuidStr,
      ),
      isOrganizationPrivate:
        fields.isOrganizationPrivate ?? before.isOrganizationPrivate,
    };
    const needed = organizationsToAuthorize(before, after);
    if (
      needed.length &&
      !(await this.rights.createsContestsInEach(principal, needed))
    )
      throw new AppError(
        'forbidden',
        403,
        'Adding or removing an organization needs the right to create contests in it',
        undefined,
        undefined,
        {
          issues: [
            {
              field: 'organizations',
              code: ORGANIZATION_RIGHTS_ISSUE,
              message: 'No right to create contests in this organization.',
            },
          ],
        },
      );
  }

  private async assertUsers(fields: Partial<Contest>): Promise<void> {
    const wanted = unique(USER_FIELDS.flatMap((field) => fields[field] ?? []));
    if (!wanted.length) return;
    const found = new Set(
      (await this.users.findByIds(wanted)).map((user) => user._id),
    );
    for (const field of USER_FIELDS)
      if ((fields[field] ?? []).some((userId) => !found.has(userId)))
        throw invalidField(field, 'Unknown user.');
  }

  /** Each problem once, existing and visible to the editor; `order` is the request's order. */
  private async contestProblems(
    principal: Principal,
    problems: ContestProblemDto[],
  ): Promise<ContestProblem[]> {
    const ids = problems.map((entry) => entry.problem);
    if (unique(ids).length !== ids.length)
      throw invalidField('problems', 'A problem appears twice.');
    const found = new Map(
      (await this.problems.findByIds(ids)).map((problem) => [
        problem._id,
        problem,
      ]),
    );
    for (const id of ids) {
      const problem = found.get(id);
      if (
        !problem ||
        !ProblemAccess.canSee(
          principal,
          ProblemAccess.accessView(problem),
          null,
        )
      )
        throw invalidField('problems', 'Unknown problem.');
    }
    return problems.map((entry, order) => ({
      problem: entry.problem,
      points: entry.points,
      partial: entry.partial ?? true,
      isPretested: entry.isPretested ?? false,
      order,
      outputPrefixOverride: entry.outputPrefixOverride ?? null,
      maxSubmissions: entry.maxSubmissions ?? null,
    }));
  }
}
