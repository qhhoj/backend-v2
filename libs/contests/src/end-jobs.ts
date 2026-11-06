import type { JobProducer } from '@libs/common';
import { finalSubmissionFormat } from './formats/final-submission';
import type { FormatName } from './formats/format';
import type { ContestFinalJudgeJob, ContestPublishJob } from './jobs';

/** One delayed job per contest and end time (BullMQ ids cannot contain `:`). */
export const finalJudgeJobId = (contestId: string, endTime: Date): string =>
  `final-judge-${contestId}-${endTime.getTime()}`;
export const publishJobId = (contestId: string, endTime: Date): string =>
  `publish-${contestId}-${endTime.getTime()}`;

export interface FinalJudgeTarget {
  id: string;
  endTime: Date;
  formatName: FormatName;
  formatConfig: unknown;
}

export interface PublishTarget {
  id: string;
  endTime: Date;
  publishAfterEnd: boolean;
}

/** FSO contests judged automatically when they end. */
const judgesAtEnd = (contest: FinalJudgeTarget): boolean =>
  contest.formatName === 'final_submission' &&
  finalSubmissionFormat.parseConfig(contest.formatConfig).autoJudge;

const delayUntil = (endTime: Date, now: number): number =>
  Math.max(0, endTime.getTime() - now);

/** After a create or an edit: the previous end's job goes, the new end's comes (delay 0 once past). Best effort: a failed removal is logged and the new job is still added (the old job finds a moved end and does nothing), and the minute sweep judges any ended contest whose job was lost. */
export async function rescheduleFinalJudge(
  finalJudges: JobProducer<ContestFinalJudgeJob>,
  change: { previous: FinalJudgeTarget | null; next: FinalJudgeTarget },
  now = Date.now(),
): Promise<void> {
  const { previous, next } = change;
  const wasScheduled = previous !== null && judgesAtEnd(previous);
  if (
    wasScheduled &&
    judgesAtEnd(next) &&
    previous.endTime.getTime() === next.endTime.getTime()
  )
    return;
  if (wasScheduled)
    await finalJudges.withdraw(finalJudgeJobId(previous.id, previous.endTime));
  if (judgesAtEnd(next))
    await finalJudges.enqueue(
      { contestId: next.id, manual: false },
      {
        jobId: finalJudgeJobId(next.id, next.endTime),
        delay: delayUntil(next.endTime, now),
      },
    );
}

/** Like `rescheduleFinalJudge`, for the automatic publish: the old job finds a moved end or a cleared switch and does nothing, and the minute sweep publishes any ended contest whose job was lost. */
export async function reschedulePublish(
  publishes: JobProducer<ContestPublishJob>,
  change: { previous: PublishTarget | null; next: PublishTarget },
  now = Date.now(),
): Promise<void> {
  const { previous, next } = change;
  const wasScheduled = previous !== null && previous.publishAfterEnd;
  if (
    wasScheduled &&
    next.publishAfterEnd &&
    previous.endTime.getTime() === next.endTime.getTime()
  )
    return;
  if (wasScheduled)
    await publishes.withdraw(publishJobId(previous.id, previous.endTime));
  if (next.publishAfterEnd)
    await publishes.enqueue(
      { contestId: next.id },
      {
        jobId: publishJobId(next.id, next.endTime),
        delay: delayUntil(next.endTime, now),
      },
    );
}
