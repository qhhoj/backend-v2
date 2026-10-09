import type {
  ContestFormatName,
  SubmissionResult,
  SubmissionStatus,
} from '@libs/database';
import { frozenTime } from './contest-time';
import { parseFormatConfig } from './formats/registry';

export const FEED_EVENT_TYPES = [
  'contest',
  'judgement-types',
  'languages',
  'groups',
  'teams',
  'problems',
  'submissions',
  'judgements',
  'state',
] as const;
export type FeedEventType = (typeof FEED_EVENT_TYPES)[number];

export interface FeedEvent {
  type: FeedEventType;
  id: string | null;
  data: Record<string, unknown>;
  token: string;
}
type Draft = Omit<FeedEvent, 'token'>;

/** Judgement types are labels, not UUIDs. `penalty`: counts as a try; `solved`: accepted. */
export const FEED_JUDGEMENT_TYPES = [
  { id: 'AC', name: 'Accepted', penalty: false, solved: true },
  { id: 'WA', name: 'Wrong Answer', penalty: true, solved: false },
  { id: 'TLE', name: 'Time Limit Exceeded', penalty: true, solved: false },
  { id: 'MLE', name: 'Memory Limit Exceeded', penalty: true, solved: false },
  { id: 'OLE', name: 'Output Limit Exceeded', penalty: true, solved: false },
  { id: 'RTE', name: 'Run-Time Error', penalty: true, solved: false },
  { id: 'CE', name: 'Compile Error', penalty: false, solved: false },
] as const;

/** Our final result to a judgement type; absent: no judgement is published (an internal error, an abort or a staff rejection is not a verdict). */
export const FEED_VERDICTS: Partial<Record<SubmissionResult, string>> = {
  AC: 'AC',
  WA: 'WA',
  SC: 'WA',
  TLE: 'TLE',
  MLE: 'MLE',
  OLE: 'OLE',
  RTE: 'RTE',
  IR: 'RTE',
  CE: 'CE',
};

export interface FeedInput {
  contest: {
    id: string;
    name: string;
    startTime: Date;
    endTime: Date;
    frozenLastMinutes: number;
    formatName: ContestFormatName;
    formatConfig: unknown;
  };
  now: Date;
  /** The key is `frozen-until-release`, unreleased, and the contest is frozen: nothing from the freeze on is published. */
  isGated: boolean;
  releasedAt: Date | null;
  languages: ReadonlyArray<{ id: string; name: string; extension: string }>;
  groups: ReadonlyArray<{ id: string; name: string }>;
  /** `start`: the participation's own start (contest time of its events counts from it). */
  teams: ReadonlyArray<{
    id: string;
    name: string;
    groupIds: readonly string[];
    start: Date;
  }>;
  problems: ReadonlyArray<{
    id: string;
    label: string;
    name: string;
    code: string;
    ordinal: number;
  }>;
  submissions: ReadonlyArray<{
    id: string;
    teamId: string;
    problemId: string;
    languageId: string;
    date: Date;
    result: SubmissionResult | null;
    status: SubmissionStatus;
    judgedDate: Date | null;
  }>;
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** `H:MM:SS.mmm`, with a leading `-` before the start. */
export function contestTime(milliseconds: number): string {
  const total = Math.abs(Math.trunc(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  const sign = milliseconds < 0 ? '-' : '';
  return `${sign}${hours}:${pad(minutes)}:${pad(seconds)}.${pad(total % 1000, 3)}`;
}

const instant = (date: Date | null): string | null =>
  date ? date.toISOString() : null;

function penaltyMinutes({
  formatName,
  formatConfig,
}: FeedInput['contest']): number {
  if (formatName !== 'icpc' && formatName !== 'vnoj') return 0;
  return (parseFormatConfig(formatName, formatConfig) as { penalty: number })
    .penalty;
}

function contestDraft({ contest }: FeedInput): Draft {
  const freeze = frozenTime(contest);
  const durationMs = contest.endTime.getTime() - contest.startTime.getTime();
  return {
    type: 'contest',
    id: contest.id,
    data: {
      id: contest.id,
      name: contest.name,
      formal_name: contest.name,
      start_time: contest.startTime.toISOString(),
      duration: contestTime(durationMs),
      scoreboard_freeze_duration: freeze
        ? contestTime(contest.endTime.getTime() - freeze.getTime())
        : null,
      penalty_time: penaltyMinutes(contest),
    },
  };
}

function stateDraft(input: FeedInput): Draft {
  const { contest, now, isGated, releasedAt } = input;
  const freeze = frozenTime(contest);
  const hasEnded = now > contest.endTime;
  return {
    type: 'state',
    id: null,
    data: {
      started: instant(now >= contest.startTime ? contest.startTime : null),
      ended: instant(hasEnded ? contest.endTime : null),
      frozen: instant(freeze && now >= freeze ? freeze : null),
      thawed: instant(releasedAt),
      finalized: null,
      end_of_updates: instant(hasEnded && !isGated ? contest.endTime : null),
    },
  };
}

const simple = (
  type: FeedEventType,
  id: string,
  data: Record<string, unknown>,
): Draft => ({ type, id, data: { id, ...data } });

/** Teams, problems and languages the feed lists; a submission may only point at these. */
function listedIds(input: FeedInput) {
  return {
    teams: new Set(input.teams.map((team) => team.id)),
    problems: new Set(input.problems.map((problem) => problem.id)),
    languages: new Set(input.languages.map((language) => language.id)),
  };
}

/**
 * Submissions at or after the freeze are not published while gated: the feed is then what the frozen board shows.
 * A submission of a problem that left the contest, of a deleted language or of an unlisted team is never published:
 * it would refer to an id no earlier event declared.
 */
function publishedSubmissions(
  input: FeedInput,
): FeedInput['submissions'][number][] {
  const freeze = input.isGated ? frozenTime(input.contest) : null;
  const listed = listedIds(input);
  return input.submissions
    .filter(
      (submission) =>
        listed.teams.has(submission.teamId) &&
        listed.problems.has(submission.problemId) &&
        listed.languages.has(submission.languageId),
    )
    .filter((submission) => freeze === null || submission.date < freeze)
    .toSorted(
      (left, right) =>
        left.date.getTime() - right.date.getTime() ||
        left.id.localeCompare(right.id),
    );
}

function submissionDrafts(
  input: FeedInput,
  published: FeedInput['submissions'],
): Draft[] {
  const starts = new Map(input.teams.map((team) => [team.id, team.start]));
  return published.map((submission) =>
    simple('submissions', submission.id, {
      team_id: submission.teamId,
      problem_id: submission.problemId,
      language_id: submission.languageId,
      time: submission.date.toISOString(),
      contest_time: contestTime(
        submission.date.getTime() - starts.get(submission.teamId)!.getTime(),
      ),
    }),
  );
}

/** Only a finished submission with a verdict is judged; a pending or an unverdicted one is not. */
function judgementOf(
  submission: FeedInput['submissions'][number],
): string | undefined {
  if (submission.status !== 'D' || !submission.result) return undefined;
  return FEED_VERDICTS[submission.result];
}

function judgementDrafts(
  input: FeedInput,
  published: FeedInput['submissions'],
): Draft[] {
  const starts = new Map(input.teams.map((team) => [team.id, team.start]));
  return published.flatMap((submission) => {
    const type = judgementOf(submission);
    if (!type) return [];
    const start = starts.get(submission.teamId)!.getTime();
    const end = submission.judgedDate ?? submission.date;
    return [
      simple('judgements', submission.id, {
        submission_id: submission.id,
        judgement_type_id: type,
        start_time: submission.date.toISOString(),
        end_time: end.toISOString(),
        start_contest_time: contestTime(submission.date.getTime() - start),
        end_contest_time: contestTime(end.getTime() - start),
      }),
    ];
  });
}

/** Team group ids the feed lists; a group that is not listed is dropped so no team points at it. */
function teamDraft(
  team: FeedInput['teams'][number],
  groupIds: Set<string>,
): Draft {
  return simple('teams', team.id, {
    name: team.name,
    display_name: team.name,
    group_ids: team.groupIds.filter((groupId) => groupIds.has(groupId)),
  });
}

/** The feed as an ordered event list: contest, judgement types, languages, groups, teams, problems, submissions, judgements, state. Ids referenced by an event always belong to an earlier event. */
export function buildFeedEvents(input: FeedInput): FeedEvent[] {
  const published = publishedSubmissions(input);
  const groupIds = new Set(input.groups.map((group) => group.id));
  const drafts: Draft[] = [
    contestDraft(input),
    ...FEED_JUDGEMENT_TYPES.map((type) =>
      simple('judgement-types', type.id, {
        name: type.name,
        penalty: type.penalty,
        solved: type.solved,
      }),
    ),
    ...input.languages.map((language) =>
      simple('languages', language.id, {
        name: language.name,
        extensions: [language.extension],
      }),
    ),
    ...input.groups.map((group) =>
      simple('groups', group.id, { name: group.name }),
    ),
    ...input.teams.map((team) => teamDraft(team, groupIds)),
    ...input.problems.map((problem) =>
      simple('problems', problem.id, {
        label: problem.label,
        name: problem.name,
        short_name: problem.code,
        ordinal: problem.ordinal,
      }),
    ),
    ...submissionDrafts(input, published),
    ...judgementDrafts(input, published),
    stateDraft(input),
  ];
  return drafts.map((draft, index) => ({ ...draft, token: String(index + 1) }));
}
