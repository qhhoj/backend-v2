import type { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { JOB_RETENTION, JOB_RETRY, withinTimeout } from '@libs/judging';
import {
  CONTEST_ENQUEUE_TIMEOUT_MS,
  contestActionState,
  WAITING_JOB_TYPES,
} from './queues';

export const CONTEST_REPLAY_QUEUE = 'contest-replay';
export const CONTEST_REPLAY_JOB = 'build';
/** The judge keeps working after the end; a replay built earlier would miss submissions. No replay is built or served before the end plus this. */
export const REPLAY_SETTLE_MS = 10 * 60_000;
/** Rebuild a contest's replay from its live participations' submissions. No `jobId`, like the rescore. */
export interface ContestReplayJob {
  contestId: string;
}

export interface ReplayRequestOptions {
  /** A request while a build runs: 'queue' adds another (the run read older data: rescore, ghost change, editor button); 'skip' adds nothing (a reader's poll must never pile up builds). */
  ifRunning?: 'queue' | 'skip';
  /** Wait before the build may start; see `replayDelayMs`. */
  delayMs?: number;
}

export const replayReadyAt = (endTime: Date): Date =>
  new Date(endTime.getTime() + REPLAY_SETTLE_MS);

/** Milliseconds until a build may write a head: 0 once end + settle has passed. */
export const replayDelayMs = (endTime: Date, now: Date): number =>
  Math.max(0, replayReadyAt(endTime).getTime() - now.getTime());

/** A build made before end + settle may lack late judgements (or predate an end time that moved). */
export const isReplayFinal = (builtAt: Date, endTime: Date): boolean =>
  builtAt.getTime() >= replayReadyAt(endTime).getTime();

/** `contestActionState` reports 'running' first, so it hides a build that waits behind the running one. */
const hasWaitingBuild = async (
  queue: Queue<ContestReplayJob>,
  contestId: string,
): Promise<boolean> =>
  (await queue.getJobs(WAITING_JOB_TYPES)).some(
    (job) => job.data.contestId === contestId,
  );

/** Coalesces per contest: a build that has not started yet (waiting or delayed) will read current data, so a second request adds nothing; a running one adds at most one waiting build, and none when `ifRunning` is 'skip'. */
export async function requestReplayBuild(
  queue: Queue<ContestReplayJob>,
  contestId: string,
  { ifRunning = 'queue', delayMs = 0 }: ReplayRequestOptions = {},
): Promise<void> {
  if (await hasWaitingBuild(queue, contestId)) return;
  if (
    ifRunning === 'skip' &&
    (await contestActionState(queue, contestId)) === 'running'
  )
    return;
  await queue.add(
    CONTEST_REPLAY_JOB,
    { contestId },
    { ...JOB_RETRY, ...JOB_RETENTION, delay: delayMs },
  );
}

/** Never throws: the replay is derived data, and the next trigger repairs a lost request (logged). */
export async function notifyReplayBuild(
  queue: Queue<ContestReplayJob>,
  contestId: string,
  logger: Logger,
  options: ReplayRequestOptions = {},
): Promise<boolean> {
  try {
    await withinTimeout(
      requestReplayBuild(queue, contestId, options),
      CONTEST_ENQUEUE_TIMEOUT_MS,
    );
    return true;
  } catch (error) {
    logger.error(
      `Replay of contest ${contestId} not enqueued: ${(error as Error).message}`,
    );
    return false;
  }
}
