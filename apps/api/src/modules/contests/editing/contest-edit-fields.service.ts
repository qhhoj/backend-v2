import { Injectable } from '@nestjs/common';
import { hasPermission, sha256, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { AppError, invalidField, sameJson, unique } from '@libs/common';
import { FormatConfigError, parseFormatConfig } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest, ContestProblem, Problem } from '@libs/database';
import { renderMarkdown, RenderLimitError } from '@libs/render';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import {
  leavesForSite,
  ORGANIZATION_RIGHTS_ISSUE,
  organizationRightsRefusal,
  organizationsToAuthorize,
  SITE_CONTEST_RIGHTS_ISSUE,
} from '../../organizations/creation/organization-move';
import type { OrganizationScope } from '../../organizations/creation/organization-move';
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

/** A contest's organization fields before and after an edit (ids as strings); `current` is null for a new contest. */
function organizationChange(
  fields: Partial<Contest>,
  current: Pick<Contest, 'organizations' | 'isOrganizationPrivate'> | null,
): { before: OrganizationScope; after: OrganizationScope } {
  const before = {
    organizations: (current?.organizations ?? []).map(uuidStr),
    isOrganizationPrivate: current?.isOrganizationPrivate ?? false,
  };
  const after = {
    organizations: (fields.organizations ?? before.organizations).map(uuidStr),
    isOrganizationPrivate:
      fields.isOrganizationPrivate ?? before.isOrganizationPrivate,
  };
  return { before, after };
}

/**
 * A contest shows its problems to every participant, so seeing a problem is not enough to add one: the editor must
 * edit it, or it must already be public to everyone; `judge.edit_all_contest` adds any. Members-only organization
 * problems have one more way in (`ContestEditFieldsService.usableAsMembersOnly`).
 */
function usableInContest(principal: Principal, problem: Problem): boolean {
  const view = ProblemAccess.accessView(problem);
  return (
    hasPermission(principal, 'judge.edit_all_contest') ||
    ProblemAccess.isSitePublic(view) ||
    ProblemAccess.canEdit(principal, view)
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
    const scope = organizationChange(fields, current);
    if (dto.problems !== undefined)
      fields.problems = await this.contestProblems(principal, dto.problems, {
        current,
        scope: scope.after,
      });
    if (current && !sameJson(scope.before, scope.after))
      await this.assertKeptProblemsFitScope(principal, fields, current, scope);
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
   * Without `judge.edit_all_contest`, an editor adds, removes or flips only organizations they may create contests for
   * (the organization creation rule, as for problems), site contest creators included (owner decision Q1: a contest is
   * scoped to, and charged to, only organizations its editor administers). A site creator's contest that stays public
   * only lists organizations (no scope, no charge), so it may name any, as in legacy. Moving a contest out of every
   * organization onto the site also needs `judge.add_contest`. `current` is null for a new contest (create and clone).
   * 403 with an issue code on `organizations` otherwise.
   */
  async assertOrganizationRights(
    principal: Principal,
    fields: Partial<Contest>,
    current: Pick<Contest, 'organizations' | 'isOrganizationPrivate'> | null,
  ): Promise<void> {
    if (
      (fields.organizations === undefined &&
        fields.isOrganizationPrivate === undefined) ||
      hasPermission(principal, 'judge.edit_all_contest')
    )
      return;
    const { before, after } = organizationChange(fields, current);
    const isSiteCreator = hasPermission(principal, 'judge.add_contest');
    if (
      isSiteCreator &&
      !before.isOrganizationPrivate &&
      !after.isOrganizationPrivate
    )
      return;
    const needed = organizationsToAuthorize(before, after);
    if (
      needed.length &&
      !(await this.rights.createsContestsInEach(principal, needed))
    )
      throw organizationRightsRefusal(
        ORGANIZATION_RIGHTS_ISSUE,
        'Adding or removing an organization needs the right to create contests in it',
      );
    if (leavesForSite(before, after) && !isSiteCreator)
      throw organizationRightsRefusal(
        SITE_CONTEST_RIGHTS_ISSUE,
        'Moving a contest out of every organization onto the site requires judge.add_contest',
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

  /**
   * A problem public only to its organizations' members, in a contest private to organizations that all list it and
   * that the editor administers: an organization's admins build its contests from its problems, and its members could
   * already read them.
   */
  private async usableAsMembersOnly(
    principal: Principal,
    problem: Problem,
    scope: OrganizationScope,
  ): Promise<boolean> {
    const view = ProblemAccess.accessView(problem);
    if (!view.isPublic || !view.isOrganizationPrivate) return false;
    if (!scope.isOrganizationPrivate || !scope.organizations.length)
      return false;
    if (!scope.organizations.every((id) => view.organizations.includes(id)))
      return false;
    return this.rights.administersEach(principal, scope.organizations);
  }

  /** A scope edit re-checks the members-only problems the contest keeps against the new scope: they were admitted for the old one (`usableAsMembersOnly`). 400 on `organizations` otherwise. */
  private async assertKeptProblemsFitScope(
    principal: Principal,
    fields: Partial<Contest>,
    current: ContestDocument,
    { after }: { after: OrganizationScope },
  ): Promise<void> {
    const stored = new Set(
      current.problems.map((entry) => uuidStr(entry.problem)),
    );
    const kept = (fields.problems ?? current.problems)
      .map((entry) => uuidStr(entry.problem))
      .filter((id) => stored.has(id));
    for (const problem of await this.problems.findByIds(kept)) {
      const view = ProblemAccess.accessView(problem);
      if (!view.isPublic || !view.isOrganizationPrivate) continue;
      if (usableInContest(principal, problem)) continue;
      if (!(await this.usableAsMembersOnly(principal, problem, after)))
        throw invalidField(
          'organizations',
          `Problem ${problem.code} is public only to members of organizations this scope does not match; remove it first.`,
        );
    }
  }

  /** Each problem once and existing, and admitted (`assertProblemsAdmitted`); `order` is the request's order. */
  private async contestProblems(
    principal: Principal,
    problems: ContestProblemDto[],
    contest: { current: ContestDocument | null; scope: OrganizationScope },
  ): Promise<ContestProblem[]> {
    const ids = problems.map((entry) => entry.problem);
    if (unique(ids).length !== ids.length)
      throw invalidField('problems', 'A problem appears twice.');
    await this.assertProblemsAdmitted(principal, ids, contest);
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

  /** Each problem exists, and one not yet in the contest (`current`, null for create and clone) is one the editor may put in it under `scope` (`usableInContest`, `usableAsMembersOnly`). 400 on `problems` otherwise. */
  async assertProblemsAdmitted(
    principal: Principal,
    ids: string[],
    contest: { current: ContestDocument | null; scope: OrganizationScope },
  ): Promise<void> {
    const found = new Map(
      (await this.problems.findByIds(ids)).map((problem) => [
        problem._id,
        problem,
      ]),
    );
    const kept = new Set(
      (contest.current?.problems ?? []).map((entry) => uuidStr(entry.problem)),
    );
    for (const id of ids) {
      const problem = found.get(id);
      const usable =
        problem &&
        (kept.has(id) ||
          usableInContest(principal, problem) ||
          (await this.usableAsMembersOnly(principal, problem, contest.scope)));
      if (!usable) throw invalidField('problems', 'Unknown problem.');
    }
  }
}
