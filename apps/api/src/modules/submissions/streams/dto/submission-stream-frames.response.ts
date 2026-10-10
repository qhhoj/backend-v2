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
  /** Submission id. */
  submissionId!: string;
  /** Submitter id. */
  userId!: string;
  /** Problem id. */
  problemId!: string;
  /** The SSE event name repeats it. */
  @ApiProperty({ enum: SUBMISSION_EVENT_TYPES }) type!: SubmissionEventType;
  /** Judging state: `QU` queued, `P` processing, `G` grading, `D` done, `IE` internal error, `CE` compile error, `AB` aborted, `PD` pending final judging at contest end. */
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
  /** The next case being judged on `test-case`, else 0. */
  currentTestcase!: number;
}

/** The `data` of a public-feed frame: ids and status, no progress. */
export class SubmissionFeedEventResponse {
  /** Submission id. */
  submissionId!: string;
  /** Submitter id. */
  userId!: string;
  /** Problem id. */
  problemId!: string;
  /** Event type: `queued`, `processing`, `grading-begin` or `done`. */
  @ApiProperty({ enum: FEED_EVENT_TYPES }) type!: SubmissionEventType;
  /** Judging state: `QU` queued, `P` processing, `G` grading, `D` done, `IE` internal error, `CE` compile error, `AB` aborted, `PD` pending final judging at contest end. */
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
}

/** What a stream starts with, so a page that reconnects never misses the end. */
export class SubmissionStateEventResponse {
  /** Submission id. */
  submissionId!: string;
  /** Judging state: `QU` queued, `P` processing, `G` grading, `D` done, `IE` internal error, `CE` compile error, `AB` aborted, `PD` pending final judging at contest end. */
  @ApiProperty({ enum: SUBMISSION_STATUSES, enumName: 'SubmissionStatus' })
  status!: SubmissionStatus;
  /** Verdict: `AC` accepted, `WA` wrong answer, `TLE` time limit, `MLE` memory limit, `OLE` output limit, `IR` invalid return, `RTE` runtime error, `CE` compile error, `IE` internal error, `SC` short circuited, `AB` aborted, `RJ` rejected; null while unjudged. */
  @ApiProperty({
    enum: SUBMISSION_RESULTS,
    enumName: 'SubmissionResult',
    nullable: true,
  })
  result!: SubmissionResult | null;
  /** Points awarded for the submission; null while unjudged. */
  points!: number | null;
  /** Points earned over all test cases. */
  casePoints!: number;
  /** Points available over all test cases. */
  caseTotal!: number;
  /** The progress `test-case` events carry; null when the viewer may not see case results. */
  currentTestcase!: number | null;
}

/** `queued`, `processing`, `grading-begin`, `test-case` or `done` on a single submission's stream. */
export class SubmissionProgressFrame {
  /** Event name. */
  @ApiProperty({ enum: SUBMISSION_EVENT_TYPES })
  event!: SubmissionEventType;
  /** Event payload. */
  data!: SubmissionProgressEventResponse;
}

/** `queued`, `processing`, `grading-begin` or `done` on the public feed. */
export class SubmissionFeedFrame {
  /** Event name. */
  @ApiProperty({ enum: FEED_EVENT_TYPES }) event!: SubmissionEventType;
  /** Event payload. */
  data!: SubmissionFeedEventResponse;
}

/** Sent first on a single submission's stream. */
export class SubmissionStateFrame {
  /** Always `state`. */
  @ApiProperty({ enum: ['state'] }) event!: 'state';
  /** Event payload. */
  data!: SubmissionStateEventResponse;
}
