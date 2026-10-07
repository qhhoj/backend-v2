import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { hasPermission, sha256, UsersRepository } from '@libs/auth';
import type { Permission, Principal } from '@libs/auth';
import { AppError, unique } from '@libs/common';
import {
  CONTEST_RESCORE_QUEUE,
  enqueueContestRescore,
  FormatConfigError,
  notifyContestRescore,
  parseFormatConfig,
} from '@libs/contests';
import type { ContestRescoreJob } from '@libs/contests';
import { uuidStr } from '@libs/database';
import type { Contest, ContestProblem } from '@libs/database';
import { renderMarkdown, RenderLimitError } from '@libs/render';
import { ProblemAccess } from '../problems/problem-access';
import { ProblemsRepository } from '../problems/problems.repository';
import { ContestAccess } from './contest-access';
import { ContestsRepository } from './contests.repository';
import type { ContestDocument } from './contests.repository';
import { ContestsService } from './contests.service';
import type { ContestDetailResponse } from './dto/contest-detail.response';
import type { QueuedResponse } from './dto/queued.response';
import type {
  ContestProblemDto,
  CreateContestDto,
  UpdateContestDto,
} from './dto/contest-edit.dto';

/** Legacy `VNOJ_CONTEST_DURATION_LIMIT`, in whole days (`timedelta.days`). */
export const CONTEST_DURATION_LIMIT_DAYS = 14;
/** `GET /contests/current` shadows a contest with this key. */
export const RESERVED_CONTEST_KEYS: readonly string[] = ['current'];
const DAY_MS = 86_400_000;

/** Legacy admin `get_readonly_fields`: a request may change these only with the permission. */
const GATED_FIELDS: ReadonlyArray<[keyof Contest, Permission]> = [
  ['isRated', 'judge.contest_rating'],
  ['rateAll', 'judge.contest_rating'],
  ['rateExclude', 'judge.contest_rating'],
  ['ratingFloor', 'judge.contest_rating'],
  ['ratingCeiling', 'judge.contest_rating'],
  ['lockedAfter', 'judge.lock_contest'],
  ['accessCodeHash', 'judge.contest_access_code'],
  ['isPrivate', 'judge.create_private_contest'],
  ['privateContestants', 'judge.create_private_contest'],
  ['isOrganizationPrivate', 'judge.create_private_contest'],
  ['organizations', 'judge.create_private_contest'],
];
/** Stored values of a new contest, to tell which gated fields a create request changes. */
const CREATE_BASELINE: Partial<Record<keyof Contest, unknown>> = {
  isRated: false,
  rateAll: false,
  rateExclude: [],
  ratingFloor: null,
  ratingCeiling: null,
  lockedAfter: null,
  accessCodeHash: null,
  isPrivate: false,
  privateContestants: [],
  isOrganizationPrivate: false,
  organizations: [],
  isVisible: false,
};
const NULLABLE_FIELDS: ReadonlyArray<keyof UpdateContestDto> = [
  'timeLimit',
  'registrationStart',
  'registrationEnd',
  'lockedAfter',
  'ratingFloor',
  'ratingCeiling',
];
const USER_FIELDS = [
  'authors',
  'curators',
  'testers',
  'privateContestants',
  'bannedUsers',
  'viewContestScoreboard',
  'rateExclude',
] as const;

const invalid = (field: string, message: string) =>
  new AppError('validation_failed', 400, message, { [field]: [message] });
const sameJson = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);
/** What every participation's results depend on (legacy admin rescored on these and on the problem inlines). */
const scoringOf = (contest: Contest) =>
  JSON.stringify([
    contest.formatName,
    contest.formatConfig,
    contest.frozenLastMinutes,
    contest.pointsPrecision,
    contest.problems.map((entry) => [
      uuidStr(entry.problem),
      entry.points,
      entry.partial,
      entry.order,
    ]),
  ]);

@Injectable()
export class ContestEditingService {
  private readonly logger = new Logger(ContestEditingService.name);

  constructor(
    private readonly contests: ContestsRepository,
    private readonly contestsService: ContestsService,
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
    @InjectQueue(CONTEST_RESCORE_QUEUE)
    private readonly rescores: Queue<ContestRescoreJob>,
  ) {}

  /** Legacy `CreateContest`: the creator becomes an author. */
  async create(
    principal: Principal,
    dto: CreateContestDto,
  ): Promise<ContestDetailResponse> {
    if (RESERVED_CONTEST_KEYS.includes(dto.key))
      throw invalid('key', 'This key is reserved.');
    const fields = await this.toFields(principal, dto, null);
    const contest = await this.contests.create({
      ...fields,
      key: dto.key,
      authors: unique([...(fields.authors ?? []), principal.userId]),
    });
    return this.contestsService.detail(principal, contest.key);
  }

  /** Scoring edits queue a rescore; a new lock is copied onto live submissions. */
  async update(
    principal: Principal,
    key: string,
    dto: UpdateContestDto,
  ): Promise<ContestDetailResponse> {
    const contest = await this.editableContest(principal, key);
    const fields = await this.toFields(principal, dto, contest);
    if (
      contest.formatName === 'final_submission' &&
      fields.formatName &&
      fields.formatName !== contest.formatName &&
      (await this.contests.hasPendingSubmissions(contest._id))
    )
      throw new AppError(
        'conflict',
        409,
        'Judge the pending submissions before leaving final_submission',
      );
    const updated = await this.contests.update(contest._id, fields);
    if (scoringOf(updated) !== scoringOf(contest))
      void notifyContestRescore(this.rescores, contest._id, this.logger);
    if (
      fields.lockedAfter !== undefined &&
      !sameJson(fields.lockedAfter, contest.lockedAfter)
    )
      await this.contests.propagateLock(contest._id, fields.lockedAfter);
    return this.contestsService.detail(principal, key);
  }

  /** An editor's manual rescore (legacy admin action). */
  async rescore(principal: Principal, key: string): Promise<QueuedResponse> {
    const contest = await this.editableContest(principal, key);
    await enqueueContestRescore(this.rescores, contest._id);
    return { queued: true };
  }

  private async editableContest(
    principal: Principal,
    key: string,
  ): Promise<ContestDocument> {
    const contest = await this.contestsService.visibleContest(principal, key);
    if (!ContestAccess.canEdit(principal, ContestAccess.accessView(contest)))
      throw new AppError('forbidden', 403, 'You cannot edit this contest');
    return contest;
  }

  /** The DTO as stored fields, checked against `current` (null on create). */
  private async toFields(
    principal: Principal,
    dto: UpdateContestDto,
    current: ContestDocument | null,
  ): Promise<Partial<Contest>> {
    for (const [field, value] of Object.entries(dto))
      if (
        value === null &&
        !NULLABLE_FIELDS.includes(field as keyof UpdateContestDto)
      )
        throw invalid(field, `${field} cannot be null.`);
    const {
      accessCode,
      problems,
      formatConfig,
      startTime,
      endTime,
      registrationStart,
      registrationEnd,
      lockedAfter,
      ...plain
    } = dto;
    const toDate = (value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : new Date(value);
    const fields: Partial<Contest> = { ...plain };
    const dates = {
      startTime: toDate(startTime),
      endTime: toDate(endTime),
      registrationStart: toDate(registrationStart),
      registrationEnd: toDate(registrationEnd),
      lockedAfter: toDate(lockedAfter),
    };
    for (const [field, value] of Object.entries(dates))
      if (value !== undefined) Object.assign(fields, { [field]: value });
    if (accessCode !== undefined)
      fields.accessCodeHash = accessCode ? sha256(accessCode) : null;
    if (problems !== undefined)
      fields.problems = await this.contestProblems(principal, problems);
    if (dto.description !== undefined)
      fields.descriptionHtml = this.render(dto.description);
    if (
      !current ||
      formatConfig !== undefined ||
      dto.formatName !== undefined
    ) {
      const formatName = dto.formatName ?? current?.formatName ?? 'default';
      const raw =
        formatConfig !== undefined
          ? formatConfig
          : formatName === current?.formatName
            ? current.formatConfig
            : null;
      try {
        fields.formatConfig = parseFormatConfig(formatName, raw);
      } catch (error) {
        if (!(error instanceof FormatConfigError)) throw error;
        throw invalid('formatConfig', `${formatName}: ${error.message}`);
      }
    }
    const merged = { ...(current?.toObject() ?? {}), ...fields } as Contest;
    this.assertWindow(principal, merged);
    this.assertGates(
      principal,
      fields,
      current ? current.toJSON() : CREATE_BASELINE,
      merged,
    );
    await this.assertUsers(fields);
    return fields;
  }

  /** Legacy `Contest.clean` and `ContestForm.clean`. */
  private assertWindow(principal: Principal, contest: Contest): void {
    const { startTime, endTime, registrationStart, registrationEnd } = contest;
    if (startTime >= endTime)
      throw invalid('endTime', 'The contest must end after it starts.');
    if (
      registrationStart &&
      registrationEnd &&
      registrationStart >= registrationEnd
    )
      throw invalid(
        'registrationEnd',
        'Registration must end after it starts.',
      );
    if (registrationStart && registrationStart >= startTime)
      throw invalid(
        'registrationStart',
        'Registration must start before the contest.',
      );
    if (registrationEnd && registrationEnd >= endTime)
      throw invalid(
        'registrationEnd',
        'Registration must end before the contest ends.',
      );
    const days = Math.floor((endTime.getTime() - startTime.getTime()) / DAY_MS);
    if (
      days > CONTEST_DURATION_LIMIT_DAYS &&
      !hasPermission(principal, 'judge.long_contest_duration')
    )
      throw invalid(
        'endTime',
        `A contest cannot last longer than ${CONTEST_DURATION_LIMIT_DAYS} days.`,
      );
  }

  /** A gate fires only when the request changes the value; making a contest visible needs `change_contest_visibility`, or `create_private_contest` for a private one (legacy `save_model`). */
  private assertGates(
    principal: Principal,
    fields: Partial<Contest>,
    baseline: Record<string, unknown>,
    merged: Contest,
  ): void {
    const normalized = fields as Record<string, unknown>;
    const changes = (field: keyof Contest) =>
      normalized[field] !== undefined &&
      !sameJson(normalized[field], baseline[field]);
    for (const [field, permission] of GATED_FIELDS)
      if (changes(field) && !hasPermission(principal, permission))
        throw new AppError(
          'forbidden',
          403,
          `Changing ${field === 'accessCodeHash' ? 'accessCode' : field} requires ${permission}`,
        );
    if (
      fields.isVisible === true &&
      baseline.isVisible !== true &&
      !hasPermission(principal, 'judge.change_contest_visibility')
    ) {
      const privately = merged.isPrivate || merged.isOrganizationPrivate;
      if (
        !privately ||
        !hasPermission(principal, 'judge.create_private_contest')
      )
        throw new AppError(
          'forbidden',
          403,
          'Making a contest visible requires judge.change_contest_visibility',
        );
    }
  }

  private async assertUsers(fields: Partial<Contest>): Promise<void> {
    const wanted = unique(USER_FIELDS.flatMap((field) => fields[field] ?? []));
    if (!wanted.length) return;
    const found = new Set(
      (await this.users.findByIds(wanted)).map((user) => user._id),
    );
    for (const field of USER_FIELDS)
      if ((fields[field] ?? []).some((userId) => !found.has(userId)))
        throw invalid(field, 'Unknown user.');
  }

  /** Each problem once, existing and visible to the editor; `order` is the request's order. */
  private async contestProblems(
    principal: Principal,
    problems: ContestProblemDto[],
  ): Promise<ContestProblem[]> {
    const ids = problems.map((entry) => entry.problem);
    if (unique(ids).length !== ids.length)
      throw invalid('problems', 'A problem appears twice.');
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
        throw invalid('problems', 'Unknown problem.');
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

  private render(text: string): string {
    try {
      return renderMarkdown(text, 'problem');
    } catch (error) {
      if (!(error instanceof RenderLimitError)) throw error;
      throw invalid('description', error.message);
    }
  }
}
