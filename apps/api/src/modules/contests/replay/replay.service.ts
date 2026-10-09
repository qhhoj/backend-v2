import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Principal } from '@libs/auth';
import { RateLimitService, unique } from '@libs/common';
import {
  CONTEST_REPLAY_QUEUE,
  isReplayFinal,
  notifyReplayBuild,
  problemLabel,
  REPLAY_FORMAT_VERSION,
  replayDelayMs,
  requestReplayBuild,
} from '@libs/contests';
import type { ContestReplayJob, ReplayEvent } from '@libs/contests';
import { ProblemsRepository } from '../../problems/core/problems.repository';
import { ContestViewerService } from '../core/contest-viewer.service';
import type { ContestDocument } from '../core/contests.repository';
import type { QueuedResponse } from '../core/dto/queued.response';
import { RankingUsersRepository } from '../ranking/ranking-users.repository';
import type { ReplayGhostResponse, ReplayResponse } from './dto/replay.dto';
import {
  REPLAY_REBUILD_LIMIT,
  REPLAY_REBUILD_WINDOW_SECONDS,
} from './rate-limits';
import { assertEnded, assertReplayReadable } from './replay-access';
import { replayRefusal, withCodedRefusals } from './replay-refusal';
import { ReplaysRepository } from './replays.repository';
import type { StoredReplayHead } from './replays.repository';

const BUILDING: ReplayResponse = {
  state: 'building',
  buildId: null,
  builtAt: null,
  chunk: 0,
  chunkCount: 0,
  participants: null,
  problems: null,
  ghosts: null,
  events: [],
};
/** Readers poll the anonymous `building` answer every few seconds; one enqueue per contest per window is plenty. */
const LAZY_BUILD_WINDOW_SECONDS = 30;

interface ChunkRequest {
  chunk: number;
  /** The `buildId` chunk 0 returned; required for `chunk > 0`. */
  build?: string;
}

const replayChanged = () =>
  replayRefusal(
    409,
    'replay_changed',
    'The replay was rebuilt; reload it from chunk 0',
  );

/** A head of the current format, built after the end plus the settle time. */
const isServable = (
  head: StoredReplayHead,
  contest: ContestDocument,
): boolean =>
  head.formatVersion === REPLAY_FORMAT_VERSION &&
  isReplayFinal(head.builtAt, contest.endTime);

@Injectable()
export class ReplayService {
  private readonly logger = new Logger(ReplayService.name);

  constructor(
    private readonly viewers: ContestViewerService,
    private readonly replays: ReplaysRepository,
    private readonly rankingUsers: RankingUsersRepository,
    private readonly problems: ProblemsRepository,
    private readonly rateLimit: RateLimitService,
    @InjectQueue(CONTEST_REPLAY_QUEUE)
    private readonly queue: Queue<ContestReplayJob>,
  ) {}

  /** The gate runs before anything is read or queued. No servable head answers `building` after queueing at most one build. Every refusal carries `issues[].code`. */
  read(
    principal: Principal | null,
    key: string,
    request: ChunkRequest,
    now = new Date(),
  ): Promise<ReplayResponse> {
    return withCodedRefusals(async () => {
      const contest = await this.viewers.visibleContest(principal, key);
      assertReplayReadable(principal, contest, now);
      const head = await this.replays.findHead(contest._id);
      if (!head || !isServable(head, contest))
        return this.building(contest, now);
      return this.chunkResponse(contest, head, request);
    });
  }

  /** Ended contests only (the worker builds nothing earlier); waits for the settle time when the end is recent. A failed enqueue gives the editor's budget back. */
  rebuild(
    principal: Principal,
    key: string,
    now = new Date(),
  ): Promise<QueuedResponse> {
    return withCodedRefusals(async () => {
      const contest = await this.viewers.editableContest(principal, key);
      assertEnded(contest, now);
      const refund = await this.rateLimit.reserve(
        [`replay-rebuild:${contest._id}:${principal.userId}`],
        REPLAY_REBUILD_LIMIT,
        REPLAY_REBUILD_WINDOW_SECONDS,
      );
      try {
        await requestReplayBuild(this.queue, contest._id, {
          delayMs: replayDelayMs(contest.endTime, now),
        });
      } catch (error) {
        await refund();
        throw error;
      }
      return { queued: true };
    });
  }

  private async chunkResponse(
    contest: ContestDocument,
    head: StoredReplayHead,
    request: ChunkRequest,
  ): Promise<ReplayResponse> {
    const { chunk } = request;
    if (chunk > 0) this.assertSameBuild(head, request.build);
    if (chunk >= head.chunkCount)
      throw replayRefusal(
        404,
        'replay_chunk_not_found',
        'No such replay chunk',
      );
    const events = await this.replays.findChunk(
      contest._id,
      head.buildId,
      chunk,
    );
    if (!events) throw replayChanged();
    const first =
      chunk === 0 ? await this.firstChunkParts(contest, head) : null;
    return {
      state: 'ready',
      buildId: head.buildId,
      builtAt: head.builtAt.toISOString(),
      chunk,
      chunkCount: head.chunkCount,
      participants: first?.participants ?? null,
      problems: first?.problems ?? null,
      ghosts: first?.ghosts ?? null,
      events,
    };
  }

  /** Participant and problem indexes are positions in chunk 0's lists, so a chunk of another build would put events on the wrong rows. */
  private assertSameBuild(
    head: StoredReplayHead,
    build: string | undefined,
  ): void {
    if (build === undefined)
      throw replayRefusal(
        400,
        'replay_build_required',
        'Send the buildId that chunk 0 returned as build',
      );
    if (build !== head.buildId) throw replayChanged();
  }

  private async building(
    contest: ContestDocument,
    now: Date,
  ): Promise<ReplayResponse> {
    if (!(await this.mayEnqueue(contest._id))) return BUILDING;
    const isQueued = await notifyReplayBuild(
      this.queue,
      contest._id,
      this.logger,
      {
        ifRunning: 'skip',
        delayMs: replayDelayMs(contest.endTime, now),
      },
    );
    if (!isQueued)
      throw replayRefusal(
        404,
        'replay_not_ready',
        'The replay is not available yet',
      );
    return BUILDING;
  }

  private async mayEnqueue(contestId: string): Promise<boolean> {
    return (
      (await this.rateLimit.hit(
        `replay-lazy:${contestId}`,
        LAZY_BUILD_WINDOW_SECONDS,
      )) === 1
    );
  }

  private async firstChunkParts(
    contest: ContestDocument,
    head: StoredReplayHead,
  ) {
    const users = await this.rankingUsers.rankingUsersOf(
      unique(head.participants.map((row) => row.userId)),
    );
    const codes = new Map(
      (
        await this.problems.findSummaries(
          head.problems.map((row) => row.problemId),
        )
      ).map((problem) => [String(problem._id), problem.code]),
    );
    return {
      participants: head.participants.map((row) => ({
        participationId: row.participationId,
        user: {
          id: row.userId,
          username: users.get(row.userId)?.username ?? '',
          rating: users.get(row.userId)?.rating ?? null,
          organization: users.get(row.userId)?.organization ?? null,
        },
      })),
      problems: head.problems.map((row, index) => ({
        problemId: row.problemId,
        code: codes.get(row.problemId) ?? row.problemId,
        label: problemLabel(index, contest.labelStyle),
        points: row.points,
      })),
      ghosts: await this.ghostsOf(contest._id, head),
    };
  }

  /** The worker scored the ghosts into their own stream; this only groups the events by ghost position. */
  private async ghostsOf(
    contestId: string,
    head: StoredReplayHead,
  ): Promise<ReplayGhostResponse[]> {
    const stored = await this.replays.findGhostEvents(
      contestId,
      head.buildId,
      head.ghostChunkCount,
    );
    if (!stored) throw replayChanged();
    const eventsOf: ReplayEvent[][] = head.ghosts.map(() => []);
    for (const event of stored) eventsOf[event[1]]?.push(event);
    return head.ghosts.map((ghost, index) => ({
      ...ghost,
      events: eventsOf[index],
    }));
  }
}
