import {
  isUuid,
  MAX_CASE_FEEDBACK_LENGTH,
  MAX_CASE_TEXT_LENGTH,
} from '@libs/database';
import type {
  CaseStatus,
  DeferralReason,
  SubmissionCase,
} from '@libs/database';
import { JudgeMessage, Outcome, RetryReason, Status } from '@libs/judge-proto';
import type {
  AssignmentRef,
  Case,
  Final,
  Hello,
  InFlight,
  Runtime,
} from '@libs/judge-proto';
import {
  MAX_CASES_PER_MESSAGE,
  MAX_FEATURES,
  MAX_HELLO_BYTES,
  MAX_LABEL_BYTES,
  MAX_LOG_BYTES,
  MAX_RUNTIMES,
  MAX_SLOTS,
} from './link-limits';
import { deferralReasonOf } from '../submissions/deferral';
import { ProtocolError, tooLarge } from './protocol-error';

/** A judge message and its encoded size; the size is known only in the deserializer. */
export interface DecodedJudgeMessage {
  message: JudgeMessage;
  bytes: number;
}

/** The `requestDeserialize` of the Session RPC. */
export const decodeJudgeMessage = (buffer: Buffer): DecodedJudgeMessage => ({
  message: JudgeMessage.decode(buffer),
  bytes: buffer.length,
});

/** Shortens to at most `maxBytes` of UTF-8 without splitting a character (the schema bounds bytes, not characters). */
export function clipBytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const bytes = Buffer.from(text, 'utf8');
  let end = maxBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

/** Longest judge-sent text (a build, a RETRY reason) quoted in a log line. */
const MAX_LOGGED_CHARS = 200;

/** Judge-sent text fit for one log line: control characters (newlines included) become spaces, clipped to `MAX_LOGGED_CHARS`. */
export function loggableText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return flat.length > MAX_LOGGED_CHARS
    ? `${flat.slice(0, MAX_LOGGED_CHARS)}…`
    : flat;
}

/** A language key as the judges admin stores it. */
const RUNTIME_KEY = /^[A-Za-z0-9_]{1,10}$/;

export interface HelloRuntime {
  language: string;
  name: string;
  version: string;
  priority: number;
}

export interface ResumeCandidate {
  ref: AssignmentRef;
  lastSeqSent: number;
}

export interface HelloInfo {
  slots: number;
  build: string;
  protocolMinor: number;
  runtimes: HelloRuntime[];
  features: string[];
  inFlight: ResumeCandidate[];
}

export function refOf(ref: AssignmentRef | undefined): AssignmentRef {
  if (!ref || !isUuid(ref.submissionId) || ref.generation < 1)
    throw new ProtocolError('a message names no valid ref');
  return { submissionId: ref.submissionId, generation: ref.generation };
}

export function seqOf(seq: number): number {
  if (seq < 1) throw new ProtocolError('seq starts at 1');
  return seq;
}

function checkHelloBounds(hello: Hello, bytes: number): void {
  if (bytes > MAX_HELLO_BYTES)
    throw tooLarge(`Hello of ${bytes} bytes, over ${MAX_HELLO_BYTES}`);
  if (hello.slots < 1 || hello.slots > MAX_SLOTS)
    throw new ProtocolError(`slots must be 1-${MAX_SLOTS}`);
  if (hello.runtimes.length > MAX_RUNTIMES)
    throw new ProtocolError(`more than ${MAX_RUNTIMES} runtimes`);
  if (hello.features.length > MAX_FEATURES)
    throw new ProtocolError(`more than ${MAX_FEATURES} features`);
  if (hello.inFlight.length > hello.slots)
    throw new ProtocolError('more runs in flight than slots');
}

const runtimeOf = (runtime: Runtime): HelloRuntime => ({
  language: runtime.languageKey,
  name: clipBytes(runtime.name, MAX_LABEL_BYTES),
  version: clipBytes(runtime.version, MAX_LABEL_BYTES),
  priority: 0,
});

const candidateOf = (entry: InFlight): ResumeCandidate => ({
  ref: refOf(entry.ref),
  lastSeqSent: entry.lastSeqSent,
});

/** Hello, bounded and normalised; runtimes with a key no language can have are dropped. */
export function helloOf(hello: Hello, bytes: number): HelloInfo {
  checkHelloBounds(hello, bytes);
  return {
    slots: hello.slots,
    build: clipBytes(hello.build, MAX_LABEL_BYTES),
    protocolMinor: hello.protocolMinor,
    runtimes: hello.runtimes
      .filter((runtime) => RUNTIME_KEY.test(runtime.languageKey))
      .map(runtimeOf),
    features: hello.features.map((feature) =>
      clipBytes(feature, MAX_LABEL_BYTES),
    ),
    inFlight: hello.inFlight.map(candidateOf),
  };
}

const CASE_STATUS: ReadonlyMap<Status, CaseStatus> = new Map([
  [Status.STATUS_AC, 'AC'],
  [Status.STATUS_WA, 'WA'],
  [Status.STATUS_TLE, 'TLE'],
  [Status.STATUS_MLE, 'MLE'],
  [Status.STATUS_OLE, 'OLE'],
  [Status.STATUS_IR, 'IR'],
  [Status.STATUS_RTE, 'RTE'],
  [Status.STATUS_SC, 'SC'],
]);

/** Negative, NaN or infinite measurements are stored as 0. */
const measured = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

/** A case earns at most its total, whatever the judge reports. */
function caseRowOf(reported: Case): SubmissionCase {
  const status = CASE_STATUS.get(reported.status);
  if (!status)
    throw new ProtocolError(`case ${reported.position} has no known status`);
  const total = measured(reported.total);
  return {
    position: reported.position,
    status,
    time: measured(reported.timeS),
    juryTime: measured(reported.juryTimeS),
    memory: measured(reported.memoryKib),
    points: Math.min(measured(reported.points), total),
    total,
    batch: reported.batch > 0 ? reported.batch : null,
    feedback: clipBytes(reported.feedback, MAX_CASE_FEEDBACK_LENGTH),
    extendedFeedback: clipBytes(
      reported.extendedFeedback,
      MAX_CASE_TEXT_LENGTH,
    ),
    output: clipBytes(reported.outputPrefix, MAX_CASE_TEXT_LENGTH),
  };
}

/** Stored case rows; texts are clipped by UTF-8 bytes, a batch number 0 means "no batch", points are clamped to the case's total. */
export function caseRowsOf(cases: Case[]): SubmissionCase[] {
  if (cases.length > MAX_CASES_PER_MESSAGE)
    throw tooLarge(
      `${cases.length} cases in one message, over ${MAX_CASES_PER_MESSAGE}`,
    );
  return cases.map(caseRowOf);
}

/** `refused`: a RETRY with reason UNSUPPORTED, the judge cannot grade this kind of submission (a refusal, not a failure; the feature it lacks is not on the wire). `deferred`: a RETRY with a transient reason (`deferralReasonOf`); the row waits and retries. `retry`: any other RETRY, a failure that counts toward the RETRY cap. */
export type FinalKind =
  | 'graded'
  | 'compile-error'
  | 'internal-error'
  | 'aborted'
  | 'retry'
  | 'refused'
  | 'deferred';

interface FinalFields {
  /** Compile log, internal error message or retry reason, clipped to 64 KiB. */
  log: string;
  dataVersionUsed: number;
}

export type FinalReport =
  | (FinalFields & { kind: Exclude<FinalKind, 'deferred'> })
  | (FinalFields & { kind: 'deferred'; reason: DeferralReason });

/** RETRY, refusal and deferral: the judge could not run it, so the row goes back to the queue. */
export const isRequeuedByJudge = (report: FinalReport): boolean =>
  report.kind === 'retry' ||
  report.kind === 'refused' ||
  report.kind === 'deferred';

/** A Final the run's row takes as it stands; a refusal also names the refusing judge build (`RunsService.refused`), a deferral its reason (`RunsService.deferred`). */
export type RunFinalReport = FinalFields & {
  kind: Exclude<FinalKind, 'refused' | 'deferred'>;
};

const FINAL_KIND: ReadonlyMap<
  Outcome,
  Exclude<FinalKind, 'refused' | 'deferred'>
> = new Map([
  [Outcome.OUTCOME_GRADED, 'graded'],
  [Outcome.OUTCOME_COMPILE_ERROR, 'compile-error'],
  [Outcome.OUTCOME_INTERNAL_ERROR, 'internal-error'],
  [Outcome.OUTCOME_ABORTED, 'aborted'],
  [Outcome.OUTCOME_RETRY, 'retry'],
]);

/** A RETRY by its reason: a refusal, a deferral, or a failure. */
function retryReport(reason: RetryReason, fields: FinalFields): FinalReport {
  if (reason === RetryReason.RETRY_REASON_UNSUPPORTED)
    return { ...fields, kind: 'refused' };
  const deferral = deferralReasonOf(reason);
  return deferral
    ? { ...fields, kind: 'deferred', reason: deferral }
    : { ...fields, kind: 'retry' };
}

export function finalReportOf(final: Final): FinalReport {
  const kind = FINAL_KIND.get(final.outcome);
  if (!kind) throw new ProtocolError('a Final with no known outcome');
  const fields = {
    log: clipBytes(final.log, MAX_LOG_BYTES),
    dataVersionUsed: final.dataVersionUsed,
  };
  return kind === 'retry'
    ? retryReport(final.reason, fields)
    : { ...fields, kind };
}
