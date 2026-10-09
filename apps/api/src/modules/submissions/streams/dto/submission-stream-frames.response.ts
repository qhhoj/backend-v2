import { ApiProperty } from '@nestjs/swagger';
import { SUBMISSION_RESULTS, SUBMISSION_STATUSES } from '@libs/database';
import type { SubmissionResult, SubmissionStatus } from '@libs/database';
import { SUBMISSION_EVENT_TYPES } from '@libs/judging';
import type { SubmissionEventType } from '@libs/judging';

/** The events of the public feed: progress per test case never leaves a viewer's own stream. */
const FEED_EVENT_TYPES = SUBMISSION_EVENT_TYPES.filter(
  (type) => type !== 'test-case',
);

/** The `data` of every progress frame: what `SubmissionEvent` carries. */
export class SubmissionProgressEventResponse {
  submissionId!: string;
  userId!: string;
  problemId!: string;
  /** The SSE event name repeats it. */
  @ApiProperty({ enum: SUBMISSION_EVENT_TYPES }) type!: SubmissionEventType;
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
  /** The next case being judged on `test-case`, else 0. */
  currentTestcase!: number;
}

/** The `data` of a public-feed frame: ids and status, no progress. */
export class SubmissionFeedEventResponse {
  submissionId!: string;
  userId!: string;
  problemId!: string;
  @ApiProperty({ enum: FEED_EVENT_TYPES }) type!: SubmissionEventType;
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
}

/** What a stream starts with, so a page that reconnects never misses the end. */
export class SubmissionStateEventResponse {
  submissionId!: string;
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
  @ApiProperty({
    enum: SUBMISSION_RESULTS,
    enumName: 'SubmissionResult',
    nullable: true,
  })
  result!: SubmissionResult | null;
  points!: number | null;
  casePoints!: number;
  caseTotal!: number;
  /** The progress `test-case` events carry; null when the viewer may not see case results. */
  currentTestcase!: number | null;
}

/** `queued`, `processing`, `grading-begin`, `test-case` or `done` on a single submission's stream. */
export class SubmissionProgressFrame {
  @ApiProperty({ enum: SUBMISSION_EVENT_TYPES })
  event!: SubmissionEventType;
  data!: SubmissionProgressEventResponse;
}

/** `queued`, `processing`, `grading-begin` or `done` on the public feed. */
export class SubmissionFeedFrame {
  @ApiProperty({ enum: FEED_EVENT_TYPES }) event!: SubmissionEventType;
  data!: SubmissionFeedEventResponse;
}

/** Sent first on a single submission's stream. */
export class SubmissionStateFrame {
  @ApiProperty({ enum: ['state'] }) event!: 'state';
  data!: SubmissionStateEventResponse;
}
