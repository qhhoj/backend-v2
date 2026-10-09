import { MAX_CASE_FEEDBACK_LENGTH, MAX_CASE_TEXT_LENGTH } from '@libs/database';
import type { Assign, Limits } from '@libs/judge-proto';
import type { BridgeTimings } from '../bridge-timings';
import type { AssignRequest } from '../submissions/assign-request';
import {
  MAX_CASES_PER_MESSAGE,
  MAX_LOG_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_SECOND,
  MAX_SUBMISSION_CASES,
} from './link-limits';

/** The Assign of a claimed run; a file-only source travels by FetchSource, not inline. */
export const assignOf = (request: AssignRequest): Assign => ({
  ref: request.ref,
  problemCode: request.problemCode,
  dataVersion: request.dataVersion,
  languageKey: request.languageKey,
  source: request.fileOnly
    ? Buffer.alloc(0)
    : Buffer.from(request.source, 'utf8'),
  sourceIsFile: request.fileOnly,
  sourceSize: request.sourceSize,
  timeLimitS: request.timeLimit,
  memoryLimitKib: request.memoryLimit,
  shortCircuit: request.shortCircuit,
  pretestsOnly: request.pretestsOnly,
  meta: {
    inContest: request.inContest ?? undefined,
    attemptNo: request.attemptNo,
    userId: request.userId,
  },
});

/** The bounds the bridge enforces, sent in Welcome so the judge can stay inside them. */
export const limitsOf = (timings: BridgeTimings): Limits => ({
  maxMessageBytes: MAX_MESSAGE_BYTES,
  maxCasesPerMessage: MAX_CASES_PER_MESSAGE,
  maxCasesPerSubmission: MAX_SUBMISSION_CASES,
  maxLogBytes: MAX_LOG_BYTES,
  maxFeedbackBytes: MAX_CASE_FEEDBACK_LENGTH,
  maxTextBytes: MAX_CASE_TEXT_LENGTH,
  maxMessagesPerSecond: MAX_MESSAGES_PER_SECOND,
  acceptTimeoutMs: timings.acceptMs,
  resumeGraceMs: timings.resumeGraceMs,
});
