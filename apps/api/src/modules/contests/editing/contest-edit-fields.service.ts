import { Injectable } from '@nestjs/common';
import { sha256, UsersRepository } from '@libs/auth';
import type { Principal } from '@libs/auth';
import { invalidField, unique } from '@libs/common';
import { FormatConfigError, parseFormatConfig } from '@libs/contests';
import type { Contest, ContestProblem } from '@libs/database';
import { renderMarkdown, RenderLimitError } from '@libs/render';
import { ProblemAccess } from '../../problems/core/problem-access';
import { ProblemsRepository } from '../../problems/core/problems.repository';
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
  'rateExclude',
] as const;

@Injectable()
export class ContestEditFieldsService {
  constructor(
    private readonly problems: ProblemsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** The DTO as stored fields, checked against `current` (null on create). */
  async toFields(
    principal: Principal,
    dto: UpdateContestDto,
    current: ContestDocument | null,
  ): Promise<Partial<Contest>> {
    for (const [field, value] of Object.entries(dto))
      if (
        value === null &&
        !NULLABLE_CONTEST_FIELDS.includes(field as keyof UpdateContestDto)
      )
        throw invalidField(field, `${field} cannot be null.`);
    const {
      accessCode,
      rankingAccessCode,
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
    if (rankingAccessCode !== undefined)
      fields.rankingAccessCodeHash = rankingAccessCode
        ? sha256(rankingAccessCode)
        : null;
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
        throw invalidField('formatConfig', `${formatName}: ${error.message}`);
      }
    }
    const merged = { ...(current?.toObject() ?? {}), ...fields } as Contest;
    assertWindow(principal, merged);
    assertGates(
      principal,
      fields,
      current ? current.toJSON() : CREATE_BASELINE,
      merged,
    );
    await this.assertUsers(fields);
    return fields;
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

  private render(text: string): string {
    try {
      return renderMarkdown(text, 'problem');
    } catch (error) {
      if (!(error instanceof RenderLimitError)) throw error;
      throw invalidField('description', error.message);
    }
  }
}
