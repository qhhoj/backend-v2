import { Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import {
  chunkEvents,
  ghostReplays,
  mergeEvents,
  REPLAY_FORMAT_VERSION,
  REPLAY_MAX_EVENTS,
  replayEvents,
  replayReadyAt,
  scoringContextOf,
} from '@libs/contests';
import type {
  GhostReplay,
  GhostSetup,
  ReplayEvent,
  RunDivisors,
} from '@libs/contests';
import { newId, uuidStr } from '@libs/database';
import { ContestResultsRepository } from '../submission-effects/contest-results.repository';
import type { ScoringContest } from '../submission-effects/contest-results.repository';
import { ContestReplayRepository } from './contest-replay.repository';
import type {
  ReplayHeadInput,
  ReplayParticipation,
} from './contest-replay.repository';

/** Participations scored at once. */
const PARTICIPATION_PARALLELISM = 8;

export interface BuildOptions {
  /** The clock; tests move it. */
  now?: Date;
  /** The safety valve; tests lower it. */
  maxEvents?: number;
}

interface BuildPlan {
  contest: ScoringContest;
  withBatches: boolean;
  divisorsOf: ReadonlyMap<string, RunDivisors>;
  /** Contest order; the position is the event `problemIndex`. */
  problemIndexes: ReadonlyMap<string, number>;
}

interface ReplayBuild {
  contestId: string;
  buildId: string;
  builtAt: Date;
  participations: ReplayParticipation[];
  eventCount: number;
  realChunks: ReplayEvent[][];
  ghosts: GhostReplay[];
  ghostChunks: ReplayEvent[][];
}

/** Chunk 0 carries the participants, problems and ghosts, so it exists even when nothing was submitted. */
const withFirstChunk = (chunks: ReplayEvent[][]): ReplayEvent[][] =>
  chunks.length ? chunks : [[]];

@Injectable()
export class ContestReplayService {
  constructor(
    private readonly results: ContestResultsRepository,
    private readonly repository: ContestReplayRepository,
  ) {}

  /** Chunks under a new build id, then the head (unless a later-started build already wrote one), then older builds' chunks go: an api read always sees one complete build. Before `endTime + REPLAY_SETTLE_MS` (the judge is still working, or the contest runs), for `final_submission` (its scores exist only after the final judge) and for a vanished contest there is no replay and any head is removed; a delayed job that runs a hair early (clock skew) removes nothing useful, and the next reader's poll queues it again. */
  async build(
    contestId: string,
    { now = new Date(), maxEvents = REPLAY_MAX_EVENTS }: BuildOptions = {},
  ): Promise<{ events: number }> {
    const contest = await this.results.findContest(contestId);
    if (!contest || !this.hasReplay(contest, now)) {
      await this.repository.removeAll(contestId);
      return { events: 0 };
    }
    // Taken before any read: a build that read newer data has the larger id.
    const buildId = newId();
    const build = await this.computeBuild(contest, buildId, now, maxEvents);
    await this.publish(contest, build);
    return { events: build.eventCount };
  }

  private async computeBuild(
    contest: ScoringContest,
    buildId: string,
    now: Date,
    maxEvents: number,
  ): Promise<ReplayBuild> {
    const plan = await this.planOf(contest);
    const participations = await this.repository.liveParticipations(
      contest._id,
    );
    const events = mergeEvents(
      await this.streamsOf(plan, participations, maxEvents),
    );
    const ghosts = ghostReplays(
      await this.repository.ghostsOf(contest._id),
      this.ghostSetupOf(contest),
    );
    return {
      contestId: contest._id,
      buildId,
      builtAt: now,
      participations,
      eventCount: events.length,
      realChunks: withFirstChunk(chunkEvents(events)),
      ghosts,
      ghostChunks: chunkEvents(
        mergeEvents(ghosts.map((ghost) => ghost.events)),
      ),
    };
  }

  private async publish(
    contest: ScoringContest,
    build: ReplayBuild,
  ): Promise<void> {
    const { contestId, buildId } = build;
    await this.repository.insertChunks(
      contestId,
      buildId,
      'real',
      build.realChunks,
    );
    await this.repository.insertChunks(
      contestId,
      buildId,
      'ghost',
      build.ghostChunks,
    );
    if (await this.repository.replaceHead(this.headOf(contest, build)))
      await this.repository.deleteBuildsBefore(contestId, buildId);
    else await this.repository.deleteBuild(contestId, buildId);
  }

  private hasReplay(contest: ScoringContest, now: Date): boolean {
    return (
      contest.formatName !== 'final_submission' &&
      now.getTime() >= replayReadyAt(contest.endTime).getTime()
    );
  }

  private orderedProblems(contest: ScoringContest) {
    return [...contest.problems].sort(
      (left, right) => left.order - right.order,
    );
  }

  private headOf(contest: ScoringContest, build: ReplayBuild): ReplayHeadInput {
    return {
      _id: build.contestId,
      buildId: build.buildId,
      builtAt: build.builtAt,
      formatVersion: REPLAY_FORMAT_VERSION,
      chunkCount: build.realChunks.length,
      ghostChunkCount: build.ghostChunks.length,
      participants: build.participations.map((row) => ({
        participationId: uuidStr(row._id),
        userId: uuidStr(row.user),
      })),
      problems: this.orderedProblems(contest).map((entry) => ({
        problemId: uuidStr(entry.problem),
        points: entry.points,
      })),
      ghosts: build.ghosts.map(({ label, caption, isUnranked, gap }) => ({
        label,
        caption,
        isUnranked,
        gap,
      })),
    };
  }

  private ghostSetupOf(contest: ScoringContest): GhostSetup {
    return {
      format: { name: contest.formatName, config: contest.formatConfig },
      startTime: contest.startTime,
      pointsPrecision: contest.pointsPrecision,
      problems: this.orderedProblems(contest).map((entry) => ({
        problemId: uuidStr(entry.problem),
        points: entry.points,
      })),
    };
  }

  private async planOf(contest: ScoringContest): Promise<BuildPlan> {
    const ordered = this.orderedProblems(contest).map((entry) =>
      uuidStr(entry.problem),
    );
    const withBatches = contest.formatName === 'ioi16';
    return {
      contest,
      withBatches,
      divisorsOf: withBatches
        ? await this.results.divisorsOf(ordered)
        : new Map(),
      problemIndexes: new Map(
        ordered.map((problemId, position) => [problemId, position]),
      ),
    };
  }

  /** Stops as soon as the running total passes `maxEvents`: a runaway contest must not fill the worker's memory. */
  private async streamsOf(
    plan: BuildPlan,
    participations: ReplayParticipation[],
    maxEvents: number,
  ): Promise<ReplayEvent[][]> {
    const streams: ReplayEvent[][] = [];
    let total = 0;
    for (
      let start = 0;
      start < participations.length;
      start += PARTICIPATION_PARALLELISM
    ) {
      const batch = participations.slice(
        start,
        start + PARTICIPATION_PARALLELISM,
      );
      const done = await Promise.all(
        batch.map((row, offset) => this.eventsOf(plan, row, start + offset)),
      );
      total += done.reduce((sum, stream) => sum + stream.length, 0);
      if (total > maxEvents)
        throw new UnrecoverableError(
          `replay_too_large: more than ${maxEvents} events`,
        );
      streams.push(...done);
    }
    return streams;
  }

  private async eventsOf(
    plan: BuildPlan,
    participation: ReplayParticipation,
    participantIndex: number,
  ): Promise<ReplayEvent[]> {
    const rows = await this.results.scoringRows(
      uuidStr(participation._id),
      plan.withBatches,
    );
    return replayEvents(
      rows,
      { name: plan.contest.formatName, config: plan.contest.formatConfig },
      scoringContextOf(plan.contest, participation, plan.divisorsOf),
      { participantIndex, problemIndexes: plan.problemIndexes },
    );
  }
}
