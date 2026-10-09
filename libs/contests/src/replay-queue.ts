import type { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
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

/** What a request did: added a build, moved a later delayed build forward (removed and added again), or left a build that has not started yet, which will read current data. */
export type ReplayRequestOutcome = 'queued' | 'rescheduled' | 'coalesced';

/** When a not-yet-started job may run. Jobs are never `changeDelay`ed (its delay counts from the call, not from `timestamp`), so this is exact. */
const dueAt = (job: Job<ContestReplayJob>): number =>
  job.timestamp + (job.delay ?? 0);

/** `contestActionState` reports 'running' first, so it hides a build that waits behind the running one. */
const waitingBuildOf = async (
  queue: Queue<ContestReplayJob>,
  contestId: string,
): Promise<Job<ContestReplayJob> | undefined> =>
  (await queue.getJobs(WAITING_JOB_TYPES)).find(
    (job) => job.data.contestId === contestId,
  );

/** False when the job started meanwhile (a running job cannot be removed). */
const removedBeforeStart = async (
  job: Job<ContestReplayJob>,
): Promise<boolean> => {
  try {
    await job.remove();
    return true;
  } catch {
    return false;
  }
};

const addBuild = (
  queue: Queue<ContestReplayJob>,
  contestId: string,
  delayMs: number,
) =>
  queue.add(
    CONTEST_REPLAY_JOB,
    { contestId },
    { ...JOB_RETRY, ...JOB_RETENTION, delay: delayMs },
  );

/** Coalesces per contest: a build that has not started yet (waiting or delayed) will read current data, so a second request adds nothing, unless that build is delayed past this request's time (queued during the contest for an end that moved earlier): then it is replaced. A running build adds at most one waiting build, and none when `ifRunning` is 'skip'. */
export async function requestReplayBuild(
  queue: Queue<ContestReplayJob>,
  contestId: string,
  { ifRunning = 'queue', delayMs = 0 }: ReplayRequestOptions = {},
): Promise<ReplayRequestOutcome> {
  const waiting = await waitingBuildOf(queue, contestId);
  if (waiting && dueAt(waiting) <= Date.now() + delayMs) return 'coalesced';
  if (waiting && (await removedBeforeStart(waiting))) {
    await addBuild(queue, contestId, delayMs);
    return 'rescheduled';
  }
  if (
    ifRunning === 'skip' &&
    (await contestActionState(queue, contestId)) === 'running'
  )
    return 'coalesced';
  await addBuild(queue, contestId, delayMs);
  return 'queued';
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
