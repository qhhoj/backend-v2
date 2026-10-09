import { Inject, Injectable } from '@nestjs/common';
import {
  buildFeedEvents,
  frozenTime,
  isFrozen,
  participationStart,
  problemLabel,
} from '@libs/contests';
import type { FeedEvent, FeedInput } from '@libs/contests';
import { AppError } from '@libs/common';
import { uuidStr } from '@libs/database';
import type { FeedLineResponse } from './dto/feed-frame.response';
import type { FeedContext } from './feed-auth.service';
import type { ContestDocument } from '../core/contests.repository';
import { FeedDataRepository } from './feed-data.repository';
import type { FeedSubmissionRow, FeedTeamRow } from './feed-data.repository';

/** The one place a feed line is shaped: the stream's documented payload is its return type. */
export const feedLineOf = (event: FeedEvent): FeedLineResponse => ({
  type: event.type,
  id: event.id,
  data: event.data,
  token: event.token,
});

export const FEED_LIMITS = Symbol('FEED_LIMITS');
export interface FeedLimits {
  /** The feed is built in memory: refuse a contest past this many submissions. */
  maxSubmissions: number;
  /** A stream keeps the submissions in memory for its whole life and rebuilds on every tick: a lower cap. */
  maxStreamSubmissions: number;
}
export const DEFAULT_FEED_LIMITS: FeedLimits = {
  maxSubmissions: 100_000,
  maxStreamSubmissions: 20_000,
};

/** What one stream remembers between ticks, so a tick reads only what changed. */
export interface FeedSession {
  rows: Map<string, FeedSubmissionRow>;
  /** The previous tick's start minus the overlap; null before the first tick. */
  since: Date | null;
  /** When `rows` was last read in full; a full re-read now and then drops rows that left the contest. */
  loadedAt: number;
}
export const newFeedSession = (): FeedSession => ({
  rows: new Map(),
  since: null,
  loadedAt: 0,
});
const FULL_RELOAD_MS = 10 * 60_000;
/** Re-reads a minute of overlap: merging by id makes a repeated row harmless, and a clock gap cannot lose one. */
const TICK_OVERLAP_MS = 60_000;

/** A release applies to the freeze that was current when it was made: a key released before the freeze began (or before an editor raised the freeze minutes) is cut again. */
const isReleasedForFreeze = (
  releasedAt: Date | null,
  freeze: Date | null,
): boolean => releasedAt !== null && freeze !== null && releasedAt >= freeze;

interface FeedParts {
  teams: FeedTeamRow[];
  submissions: FeedSubmissionRow[];
  groups: Array<{ id: string; name: string }>;
  languages: Array<{ id: string; name: string; extension: string }>;
  problemRows: Map<string, { code: string; name: string }>;
}

const contestOf = (contest: ContestDocument): FeedInput['contest'] => ({
  id: contest._id,
  name: contest.name,
  startTime: contest.startTime,
  endTime: contest.endTime,
  frozenLastMinutes: contest.frozenLastMinutes,
  formatName: contest.formatName,
  formatConfig: contest.formatConfig,
});

/** A team shows a group only when its organization is listed. */
const teamsOf = (
  contest: ContestDocument,
  { teams, groups }: FeedParts,
): FeedInput['teams'] => {
  const listedGroups = new Set(groups.map((group) => group.id));
  return teams.map((team) => ({
    id: team.id,
    name: team.username,
    groupIds:
      team.organizationId && listedGroups.has(team.organizationId)
        ? [team.organizationId]
        : [],
    start: participationStart(contest, team),
  }));
};

const problemsOf = (
  contest: ContestDocument,
  rows: FeedParts['problemRows'],
): FeedInput['problems'] =>
  [...contest.problems]
    .sort((left, right) => left.order - right.order)
    .map((entry, index) => ({
      id: uuidStr(entry.problem),
      label: problemLabel(index, contest.labelStyle),
      ordinal: index,
      name: rows.get(uuidStr(entry.problem))?.name ?? '',
      code: rows.get(uuidStr(entry.problem))?.code ?? '',
    }));

@Injectable()
export class FeedService {
  constructor(
    private readonly data: FeedDataRepository,
    @Inject(FEED_LIMITS) private readonly limits: FeedLimits,
  ) {}

  /** Gated: `frozen-until-release`, not released for the current freeze, and the contest frozen now (a freeze outlives the end until an editor lifts it). With a `session` this is one stream tick. */
  async eventsFor(
    context: FeedContext,
    now = new Date(),
    session?: FeedSession,
  ): Promise<FeedEvent[]> {
    const { contest } = context;
    if (!session || session.since === null)
      await this.assertSize(contest._id, session !== undefined);
    const teams = await this.data.teams(contest._id);
    const submissions = await this.submissionsOf(contest._id, now, session);
    const problemRows = await this.data.problemRows(
      contest.problems.map((entry) => uuidStr(entry.problem)),
    );
    const groups = await this.data.groups([
      ...new Set(
        teams.flatMap((team) =>
          team.organizationId ? [team.organizationId] : [],
        ),
      ),
    ]);
    const languages = await this.data.languageRows([
      ...new Set(submissions.map((row) => row.languageId)),
    ]);
    return buildFeedEvents(
      this.inputOf(context, now, {
        teams,
        submissions,
        groups,
        languages,
        problemRows,
      }),
    );
  }

  ndjson(events: readonly FeedEvent[]): string {
    return events
      .map((event) => `${JSON.stringify(feedLineOf(event))}\n`)
      .join('');
  }

  private async assertSize(
    contestId: string,
    isStream: boolean,
  ): Promise<void> {
    const count = await this.data.countContestSubmissions(contestId);
    if (isStream && count > this.limits.maxStreamSubmissions)
      throw new AppError(
        'feed_too_large_for_stream',
        409,
        'This contest has too many submissions to stream; poll the snapshot',
      );
    if (count > this.limits.maxSubmissions)
      throw new AppError(
        'feed_too_large',
        409,
        'This contest has too many submissions for the feed',
      );
  }

  /** No session: the whole contest. A session: all of it on the first tick, then only the rows submitted or judged since. */
  private async submissionsOf(
    contestId: string,
    now: Date,
    session?: FeedSession,
  ): Promise<FeedSubmissionRow[]> {
    if (!session) return this.data.allSubmissions(contestId);
    const isFull =
      session.since === null ||
      now.getTime() - session.loadedAt > FULL_RELOAD_MS;
    const fresh = isFull
      ? await this.data.allSubmissions(contestId)
      : await this.data.changedSubmissions(contestId, session.since as Date);
    if (isFull) {
      session.rows.clear();
      session.loadedAt = now.getTime();
    }
    for (const row of fresh) session.rows.set(row.id, row);
    session.since = new Date(now.getTime() - TICK_OVERLAP_MS);
    this.assertStreamable(session.rows.size);
    return [...session.rows.values()];
  }

  /** A contest that grew past the stream cap after the stream opened stops the stream. */
  private assertStreamable(count: number): void {
    if (count > this.limits.maxStreamSubmissions)
      throw new AppError(
        'feed_too_large_for_stream',
        409,
        'This contest has too many submissions to stream; poll the snapshot',
      );
  }

  private inputOf(
    { contest, feedKey }: FeedContext,
    now: Date,
    parts: FeedParts,
  ): FeedInput {
    const isReleased = isReleasedForFreeze(
      feedKey.releasedAt,
      frozenTime(contest),
    );
    return {
      contest: contestOf(contest),
      now,
      isGated:
        feedKey.mode === 'frozen-until-release' &&
        !isReleased &&
        isFrozen(contest, now),
      releasedAt: isReleased ? feedKey.releasedAt : null,
      languages: parts.languages,
      groups: parts.groups,
      teams: teamsOf(contest, parts),
      problems: problemsOf(contest, parts.problemRows),
      submissions: parts.submissions,
    };
  }
}
