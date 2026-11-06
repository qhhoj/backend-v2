import type { JobType } from 'bullmq';
import {
  defineJob,
  HOUR_MS,
  JOB_RETENTION,
  JOB_RETRY,
  MINUTE_MS,
  ONE_SHOT_JOB,
  SCHEDULED_RETENTION,
} from '@libs/common';
import type { JobProducer } from '@libs/common';
import { Submission } from '@libs/database';
import type { SubmissionResult } from '@libs/database';

/** Recompute every contest submission's points and every participation of the contest. Enqueued by contest edits that change scoring (format, config, start and end times, whether a time limit is set, freeze, precision, problems), disqualifications and problem rescores. An editor may narrow it to one problem or one participation (`ContestRescoreScope`). */
export interface ContestRescoreJob extends ContestRescoreScope {
  contestId: string;
}
/** At most one of the two: only that problem's submissions and the participations that sent one, or only that participation. */
export interface ContestRescoreScope {
  problemId?: string;
  participationId?: string;
}

/** Judge an FSO contest's pending submissions; `manual`: an editor's request, which ignores `autoJudge`. */
export interface ContestFinalJudgeJob {
  contestId: string;
  manual: boolean;
}

/** Delete every rating from the contest's end on, then rate every rated, ended contest from there in end-time order (legacy `Contest.rate`). */
export interface ContestRatingJob {
  contestId: string;
}

/** Publish the problems and editorials of a contest that switched `publishAfterEnd` on. */
export interface ContestPublishJob {
  contestId: string;
}

/** Rebuild a contest's replay from its live participations' submissions. */
export interface ContestReplayJob {
  contestId: string;
}

export interface ContestDataJob {
  contestId: string;
  /** Legacy `submission_problem_glob`, checked by the api (`*` and `?` over problem codes). */
  problemGlob: string;
  /** Empty: every result. */
  results: SubmissionResult[];
}

/** Zip every live contest submission with its source, plus a `submissions.csv`. */
export interface ContestExportJob {
  contestId: string;
}

export const contestDataJobId = (contestId: string): string =>
  `data-${contestId}`;
export const contestExportJobId = (contestId: string): string =>
  `export-${contestId}`;

/** The contests' jobs. The rescore, rating and replay reads hint to a submissions index, as do the final judge's; each consumer starts once those indexes exist. */
export const contestJobs = {
  /** No job id: an edit during a running rescore must queue another. One at a time across worker processes, oldest first, so the run queued by the last edit settles the contest (like the problem rescore). */
  rescore: defineJob<ContestRescoreJob>({
    queue: 'contest-rescore',
    name: 'rescore',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ contestId }) => `Rescore of contest ${contestId}`,
    oneAtATime: true,
    needsIndexes: [Submission],
  }),
  /** The automatic job at the end has an id per contest and end time (`finalJudgeJobId`); an editor's request has none. */
  finalJudge: defineJob<ContestFinalJudgeJob>({
    queue: 'contest-final-judge',
    name: 'judge-final',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ contestId }) => `Final judging of contest ${contestId}`,
    needsIndexes: [Submission],
  }),
  /** Judges any ended contest whose job was lost; overlapping sweeps are harmless, each contest's run is serialised. */
  finalJudgeSweep: defineJob<void>({
    queue: 'contest-final-judge',
    name: 'sweep',
    options: SCHEDULED_RETENTION,
    describe: () => 'Final judging sweep',
    schedule: { id: 'contest-final-judge-every-minute', every: MINUTE_MS },
  }),
  /** No job id, like the rescore: a request during a run queues another. One at a time across worker processes: two interleaved chains would rate against each other's half-deleted histories; every run starts by deleting, so retries are safe. */
  rating: defineJob<ContestRatingJob>({
    queue: 'contest-rating',
    name: 'rate',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ contestId }) => `Rating from contest ${contestId}`,
    oneAtATime: true,
    needsIndexes: [Submission],
  }),
  publish: defineJob<ContestPublishJob>({
    queue: 'contest-publish',
    name: 'publish',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ contestId }) => `Publish of contest ${contestId}`,
  }),
  /** Publishes any ended contest whose job was lost; overlapping sweeps are harmless, each contest's run is serialised. */
  publishSweep: defineJob<void>({
    queue: 'contest-publish',
    name: 'sweep',
    options: SCHEDULED_RETENTION,
    describe: () => 'Contest publish sweep',
    schedule: { id: 'contest-publish-every-minute', every: MINUTE_MS },
  }),
  /** No job id: `requestReplayBuild` coalesces per contest. One build at a time across worker processes. */
  replay: defineJob<ContestReplayJob>({
    queue: 'contest-replay',
    name: 'build',
    options: { ...JOB_RETRY, ...JOB_RETENTION },
    describe: ({ contestId }) => `Replay of contest ${contestId}`,
    oneAtATime: true,
    needsIndexes: [Submission],
  }),
  /** One zip at a time per worker process: memory and disk. */
  data: defineJob<ContestDataJob>({
    queue: 'contest-data',
    name: 'prepare',
    options: ONE_SHOT_JOB,
    jobId: ({ contestId }) => contestDataJobId(contestId),
    describe: ({ contestId }) => `Data of contest ${contestId}`,
  }),
  /** One zip at a time per worker process; the hourly zip sweep shares the queue. */
  export: defineJob<ContestExportJob>({
    queue: 'contest-export',
    name: 'export',
    options: ONE_SHOT_JOB,
    jobId: ({ contestId }) => contestExportJobId(contestId),
    describe: ({ contestId }) => `Export of contest ${contestId}`,
  }),
  /** Removes expired export and data zips from `CONTEST_DATA_ROOT`. */
  zipSweep: defineJob<void>({
    queue: 'contest-export',
    name: 'sweep',
    options: SCHEDULED_RETENTION,
    describe: () => 'Contest zip sweep',
    schedule: { id: 'contest-zip-sweep-hourly', every: HOUR_MS },
  }),
};

/** How long a re-rate after a verdict change waits for the next one: each request in that time moves the not-yet-started run back, so a bulk rejudge of an ended contest ends in one re-rate. */
export const RERATE_DEBOUNCE_MS = MINUTE_MS;

/** The re-rate a verdict change after the end requests (rejudge, reject, score override). Debounced per contest (BullMQ deduplication): a delayed run is replaced by a later request, and a request while one runs keeps one more run for after it, which reads the newer standings. Awaited and thrown. */
export const requestContestRerate = (
  ratings: JobProducer<ContestRatingJob>,
  contestId: string,
): Promise<void> =>
  ratings.add(
    { contestId },
    {
      delay: RERATE_DEBOUNCE_MS,
      deduplication: {
        id: `rerate-${contestId}`,
        replace: true,
        keepLastIfActive: true,
      },
    },
  );

export const CONTEST_ACTION_STATES = ['queued', 'running', 'idle'] as const;
export type ContestActionState = (typeof CONTEST_ACTION_STATES)[number];
export const WAITING_JOB_TYPES: JobType[] = [
  'waiting',
  'prioritized',
  'delayed',
];

/** Whether an editor's request for this contest waits in the queue, or runs now. Rescore and rating jobs carry no per-contest id, so the live jobs are scanned; failed and completed jobs are removed (`JOB_RETENTION`), so there is no "failed" state. */
export async function contestActionState<Data extends { contestId: string }>(
  jobs: JobProducer<Data>,
  contestId: string,
  isRequest: (data: Data) => boolean = () => true,
): Promise<ContestActionState> {
  const hasRequest = async (types: JobType[]): Promise<boolean> =>
    (await jobs.jobs(types)).some(
      ({ data }) => isRequest(data) && data.contestId === contestId,
    );
  if (await hasRequest(['active'])) return 'running';
  return (await hasRequest(WAITING_JOB_TYPES)) ? 'queued' : 'idle';
}
