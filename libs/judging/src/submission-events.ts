import { isUuid, SUBMISSION_STATUSES } from '@libs/database';
import type { SubmissionStatus } from '@libs/database';
import type { SubmissionGradedJob } from './queues';

/** Redis pub/sub, best effort and unordered across processes (a page treats the stored state as truth on reconnect): every writer of a submission status publishes here (the bridge for judge packets and requeues, the api for submit/rejudge/abort/reject); the api fans it out over SSE. */
export const SUBMISSION_EVENTS_CHANNEL = 'submission-events';
export const SUBMISSION_EVENT_TYPES = [
  'queued',
  'processing',
  'grading-begin',
  'test-case',
  'done',
] as const;
export type SubmissionEventType = (typeof SUBMISSION_EVENT_TYPES)[number];

/** Ids and state only: never source, cases, feedback or output. */
export interface SubmissionEvent {
  submissionId: string;
  userId: string;
  problemId: string;
  type: SubmissionEventType;
  status: SubmissionStatus;
  /** The next case to be judged on `test-case` events, else 0. */
  currentTestcase: number;
}

export const submissionEvent = (
  subject: SubmissionGradedJob,
  type: SubmissionEventType,
  status: SubmissionStatus,
  currentTestcase = 0,
): SubmissionEvent => ({
  submissionId: subject.submissionId,
  userId: subject.userId,
  problemId: subject.problemId,
  type,
  status,
  currentTestcase,
});

const isId = (value: unknown): value is string =>
  typeof value === 'string' && isUuid(value);

/** Checked before ids reach a query and rebuilt field by field, so nothing beyond the contract is ever forwarded; null = ignore. */
export function parseSubmissionEvent(raw: string): SubmissionEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const event = value as Record<string, unknown>;
  const { submissionId, userId, problemId, type, status, currentTestcase } =
    event;
  return isId(submissionId) &&
    isId(userId) &&
    isId(problemId) &&
    SUBMISSION_EVENT_TYPES.includes(type as SubmissionEventType) &&
    SUBMISSION_STATUSES.includes(status as SubmissionStatus) &&
    Number.isInteger(currentTestcase) &&
    (currentTestcase as number) >= 0
    ? submissionEvent(
        { submissionId, userId, problemId },
        type as SubmissionEventType,
        status as SubmissionStatus,
        currentTestcase as number,
      )
    : null;
}
