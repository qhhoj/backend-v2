import { unique } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { Contest } from '@libs/database';
import type { UpdateContestDto } from '../../contests/editing/dto/contest-edit.dto';
import type { SyncContestDto } from './dto/sync-contest.dto';

/** The request as the contest edit service's DTO, every field explicit: a PUT replaces, so an omitted optional field returns to its default and an identical resend compares equal. */
export function toEditDto(
  dto: SyncContestDto,
  problemIds: ReadonlyMap<string, string>,
): UpdateContestDto {
  return {
    name: dto.name,
    description: dto.description ?? '',
    startTime: dto.startTime,
    endTime: dto.endTime,
    timeLimit: dto.timeLimit ?? null,
    frozenLastMinutes: dto.frozenLastMinutes ?? 0,
    formatName: dto.formatName ?? 'default',
    formatConfig: dto.formatConfig ?? {},
    problems: dto.problems.map((entry) => ({
      problem: problemIds.get(entry.code)!,
      points: entry.points,
      partial: entry.partial ?? true,
    })),
  };
}

type SyncedFields = Pick<
  Contest,
  | 'name'
  | 'description'
  | 'startTime'
  | 'endTime'
  | 'timeLimit'
  | 'frozenLastMinutes'
  | 'formatName'
  | 'formatConfig'
  | 'problems'
>;

/** JSON with object keys sorted at every depth, so two configs that differ only in key order compare equal. */
const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : inner,
  );

/** The fields sync controls, in a shape where equal contests compare equal however dates, ids and config keys are spelled. */
export const comparableOf = (contest: SyncedFields) => ({
  name: contest.name,
  description: contest.description,
  startTime: contest.startTime.getTime(),
  endTime: contest.endTime.getTime(),
  timeLimit: contest.timeLimit,
  frozenLastMinutes: contest.frozenLastMinutes,
  formatName: contest.formatName,
  formatConfig: canonicalJson(contest.formatConfig),
  problems: [...contest.problems]
    .sort((left, right) => left.order - right.order)
    .map((entry) => [uuidStr(entry.problem), entry.points, entry.partial]),
});

export const isSameSyncedContest = (
  left: SyncedFields,
  right: SyncedFields,
): boolean =>
  JSON.stringify(comparableOf(left)) === JSON.stringify(comparableOf(right));

/** A person made it visible, or it has started: sync may then only change participants. */
export const isFrozenForSync = (
  contest: Pick<Contest, 'isVisible' | 'startTime'>,
  now: Date,
): boolean => contest.isVisible || contest.startTime <= now;

export const uniqueCodes = (dto: SyncContestDto): string[] =>
  unique(dto.problems.map((entry) => entry.code));
