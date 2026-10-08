import type { Logger } from '@nestjs/common';
import type { JobType, Queue } from 'bullmq';
import type { SubmissionResult } from '@libs/database';
import { JOB_RETENTION, JOB_RETRY, withinTimeout } from '@libs/judging';
import { finalSubmissionFormat } from './formats/final-submission';
import type { FormatName } from './formats/format';

export const CONTEST_RESCORE_QUEUE = 'contest-rescore';
export const CONTEST_RESCORE_JOB = 'rescore';
/** Recompute every contest submission's points and every participation of the contest. Enqueued by contest edits that change scoring (format, config, start and end times, freeze, precision, problems), disqualifications and problem rescores. */
export interface ContestRescoreJob {
  contestId: string;
}
/** Longest an edit waits for its job to reach Redis. */
export const CONTEST_ENQUEUE_TIMEOUT_MS = 1000;

/** No `jobId`, like `enqueueRescore`: an edit during a running rescore must queue another; the queue runs one at a time, oldest first, so the last edit wins. */
export const enqueueContestRescore = async (
  queue: Queue<ContestRescoreJob>,
  contestId: string,
): Promise<void> => {
  await queue.add(
    CONTEST_RESCORE_JOB,
    { contestId },
    {
      ...JOB_RETRY,
      ...JOB_RETENTION,
    },
  );
};

/** Never rethrown: the edit is committed; a lost rescore waits for the next scoring edit (logged). */
export async function notifyContestRescore(
  queue: Queue<ContestRescoreJob>,
  contestId: string,
  logger: Logger,
): Promise<void> {
  try {
    await withinTimeout(
      enqueueContestRescore(queue, contestId),
      CONTEST_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Rescore of contest ${contestId} not enqueued: ${(error as Error).message}`,
    );
  }
}

export const CONTEST_FINAL_JUDGE_QUEUE = 'contest-final-judge';
export const CONTEST_FINAL_JUDGE_JOB = 'judge-final';
export const CONTEST_FINAL_JUDGE_SWEEP_JOB = 'sweep';
export const CONTEST_FINAL_JUDGE_SCHEDULER = 'contest-final-judge-every-minute';
export const FINAL_JUDGE_SWEEP_MS = 60_000;

/** Judge an FSO contest's pending submissions; `manual`: an editor's request, which ignores `autoJudge`. */
export interface ContestFinalJudgeJob {
  contestId: string;
  manual: boolean;
}

/** One delayed job per contest and end time (BullMQ ids cannot contain `:`). */
export const finalJudgeJobId = (contestId: string, endTime: Date): string =>
  `final-judge-${contestId}-${endTime.getTime()}`;

export interface FinalJudgeTarget {
  id: string;
  endTime: Date;
  formatName: FormatName;
  formatConfig: unknown;
}

/** FSO contests judged automatically when they end. */
export const judgesAtEnd = (contest: FinalJudgeTarget): boolean =>
  contest.formatName === 'final_submission' &&
  finalSubmissionFormat.parseConfig(contest.formatConfig).autoJudge;

/** After a create or an edit: the previous end's job goes, the new end's comes (delay 0 once past). Never throws: the sweep judges any ended contest whose job was lost. */
export async function rescheduleFinalJudge(
  queue: Queue<ContestFinalJudgeJob>,
  change: { previous: FinalJudgeTarget | null; next: FinalJudgeTarget },
  logger: Logger,
  now = Date.now(),
): Promise<void> {
  const { previous, next } = change;
  const unchanged =
    previous !== null &&
    judgesAtEnd(previous) &&
    judgesAtEnd(next) &&
    previous.endTime.getTime() === next.endTime.getTime();
  if (unchanged) return;
  try {
    await withinTimeout(
      (async () => {
        if (previous && judgesAtEnd(previous))
          await queue.remove(finalJudgeJobId(previous.id, previous.endTime));
        if (judgesAtEnd(next))
          await queue.add(
            CONTEST_FINAL_JUDGE_JOB,
            { contestId: next.id, manual: false },
            {
              jobId: finalJudgeJobId(next.id, next.endTime),
              delay: Math.max(0, next.endTime.getTime() - now),
              ...JOB_RETRY,
              ...JOB_RETENTION,
            },
          );
      })(),
      CONTEST_ENQUEUE_TIMEOUT_MS,
    );
  } catch (error) {
    logger.error(
      `Final judging of contest ${next.id} not scheduled: ${(error as Error).message}`,
    );
  }
}

export const requestFinalJudge = async (
  queue: Queue<ContestFinalJudgeJob>,
  contestId: string,
): Promise<void> => {
  await queue.add(
    CONTEST_FINAL_JUDGE_JOB,
    { contestId, manual: true },
    { ...JOB_RETRY, ...JOB_RETENTION },
  );
};

export const CONTEST_RATING_QUEUE = 'contest-rating';
export const CONTEST_RATING_JOB = 'rate';
/** Delete every rating from the contest's end on, then rate every rated, ended contest from there in end-time order (legacy `Contest.rate`). */
export interface ContestRatingJob {
  contestId: string;
}
/** No `jobId`, like `enqueueContestRescore`: a request during a run queues another; the queue runs one at a time and every run starts by deleting, so retries are safe. */
export const enqueueContestRating = async (
  queue: Queue<ContestRatingJob>,
  contestId: string,
): Promise<void> => {
  await queue.add(
    CONTEST_RATING_JOB,
    { contestId },
    {
      ...JOB_RETRY,
      ...JOB_RETENTION,
    },
  );
};

export const CONTEST_DATA_QUEUE = 'contest-data';
export const CONTEST_DATA_JOB = 'prepare';
export interface ContestDataJob {
  contestId: string;
  /** Legacy `submission_problem_glob`, checked by the api (`*` and `?` over problem codes). */
  problemGlob: string;
  /** Empty: every result. */
  results: SubmissionResult[];
}

/** At most one job per contest (an `add` with a live id is ignored), dropped as soon as it ends either way: "running" is "the job exists", and a failure never blocks the next request. */
export const oneJobPerContest = (prefix: 'data', contestId: string) => ({
  jobId: `${prefix}-${contestId}`,
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
});
export const contestDataJobId = (contestId: string) =>
  oneJobPerContest('data', contestId).jobId;

export type ContestActionState = 'idle' | 'queued' | 'running';
const WAITING_JOB_TYPES: JobType[] = ['waiting', 'prioritized', 'delayed'];

/** Whether an editor's request for this contest waits in the queue, or runs now. Rescore and rating jobs carry no per-contest id, so the live jobs are scanned; failed and completed jobs are removed (`JOB_RETENTION`), so there is no "failed" state. */
export async function contestActionState<Data extends { contestId: string }>(
  queue: Queue<Data>,
  contestId: string,
  isRequest: (data: Data) => boolean = () => true,
): Promise<ContestActionState> {
  const isContestRequest = (data: Data): boolean =>
    isRequest(data) && data.contestId === contestId;
  const hasRequest = async (types: JobType[]): Promise<boolean> =>
    (await queue.getJobs(types)).some((job: { data: Data }) =>
      isContestRequest(job.data),
    );
  if (await hasRequest(['active'])) return 'running';
  return (await hasRequest(WAITING_JOB_TYPES)) ? 'queued' : 'idle';
}
