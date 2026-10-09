import { clipBytes } from '@libs/common';
import {
  MAX_CASE_FEEDBACK_LENGTH,
  MAX_CASE_TEXT_LENGTH,
  PROBLEM_CODE_PATTERN,
} from '@libs/database';
import type { CaseStatus } from '@libs/database';
import type { Packet } from './packet-codec';
import { ProtocolError } from './protocol.error';

/** At least the 9999 cases a problem may have; bounds one packet and one submission. */
export const MAX_SUBMISSION_CASES = 10000;
/** Bytes, for compile logs and internal error messages. */
export const MAX_LOG_LENGTH = 65536;
const MAX_NAME_LENGTH = 100;
const MAX_KEY_LENGTH = 256;
const MAX_PROBLEMS = 100000;
const MAX_EXECUTORS = 500;
const MAX_RUNTIMES_PER_EXECUTOR = 20;

export interface Runtime {
  language: string;
  name: string;
  version: string;
  priority: number;
}

export interface CaseReport {
  position: number;
  status: CaseStatus;
  time: number;
  memory: number;
  points: number;
  total: number;
  feedback: string;
  extendedFeedback: string;
  output: string;
}

export interface HandshakePacket {
  name: 'handshake';
  id: string;
  key: string;
  problems: string[];
  executors: string[];
  runtimes: Runtime[];
}

export type SubmissionPacket = { submissionId: string } & (
  | { name: 'submission-acknowledged' }
  | { name: 'grading-begin'; pretested: boolean }
  | { name: 'grading-end' }
  | { name: 'test-case-status'; cases: CaseReport[] }
  | { name: 'batch-begin' }
  | { name: 'batch-end' }
  | { name: 'compile-error'; log: string }
  | { name: 'compile-message'; log: string }
  | { name: 'internal-error'; message: string }
  | { name: 'submission-terminated' }
);

export type JudgePacket =
  | HandshakePacket
  | SubmissionPacket
  | { name: 'supported-problems'; problems: string[] }
  | { name: 'ping-response'; when: number; load: number | null };

/** Legacy `on_test_case`: the first matching flag in this order wins; no flag is AC. */
const STATUS_FLAGS: Array<[number, CaseStatus]> = [
  [4, 'TLE'],
  [8, 'MLE'],
  [64, 'OLE'],
  [2, 'RTE'],
  [16, 'IR'],
  [1, 'WA'],
  [32, 'SC'],
];
export const caseStatusFromBitmask = (bitmask: number): CaseStatus =>
  STATUS_FLAGS.find(([flag]) => (bitmask & flag) !== 0)?.[1] ?? 'AC';

const SUBMISSION_PACKETS = new Set([
  'submission-acknowledged',
  'grading-begin',
  'grading-end',
  'test-case-status',
  'batch-begin',
  'batch-end',
  'compile-error',
  'compile-message',
  'internal-error',
  'submission-terminated',
]);

const invalid = (packet: Packet, field: string): never => {
  throw new ProtocolError(`${packet.name}: invalid ${field}`);
};
const boundedText = (
  packet: Packet,
  field: string,
  maxLength: number,
): string => {
  const value = packet[field];
  return typeof value === 'string' && Buffer.byteLength(value) <= maxLength
    ? value
    : invalid(packet, field);
};
/** Logs and messages are kept, only shortened. */
const clippedText = (
  packet: Packet,
  field: string,
  maxBytes: number,
): string => {
  const value = packet[field];
  return typeof value === 'string'
    ? clipBytes(value, maxBytes)
    : invalid(packet, field);
};
const optionalText = (value: unknown, maxBytes: number): string =>
  typeof value === 'string' ? clipBytes(value, maxBytes) : '';
/** The judge reports `null` for times and memory it did not measure; negatives are clamped to zero. */
const measured = (packet: Packet, value: unknown): number =>
  value === null || value === undefined
    ? 0
    : typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, value)
      : invalid(packet, 'cases');

function problemCodes(packet: Packet): string[] {
  const { problems } = packet;
  if (!Array.isArray(problems) || problems.length > MAX_PROBLEMS)
    return invalid(packet, 'problems');
  return problems.flatMap((entry: unknown) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string')
      return invalid(packet, 'problems');
    // a judge may list codes no problem can have; they are ignored
    return PROBLEM_CODE_PATTERN.test(entry[0]) ? [entry[0]] : [];
  });
}

/** `null`, a string, or the `[major, minor, ...]` list a runtime reports. */
function versionText(packet: Packet, version: unknown): string {
  if (version === null || version === undefined) return '';
  if (typeof version === 'string') return version;
  if (
    Array.isArray(version) &&
    version.length <= MAX_RUNTIMES_PER_EXECUTOR &&
    version.every(
      (part) => typeof part === 'string' || typeof part === 'number',
    )
  )
    return version.join('.');
  return invalid(packet, 'executors');
}

function handshake(packet: Packet): HandshakePacket {
  const { executors } = packet;
  if (
    typeof executors !== 'object' ||
    executors === null ||
    Array.isArray(executors) ||
    Object.keys(executors).length > MAX_EXECUTORS
  )
    return invalid(packet, 'executors');
  const runtimes = Object.entries(executors).flatMap(([language, versions]) => {
    if (
      Buffer.byteLength(language) > MAX_NAME_LENGTH ||
      !Array.isArray(versions) ||
      versions.length > MAX_RUNTIMES_PER_EXECUTOR
    )
      return invalid(packet, 'executors');
    return versions.map((entry: unknown, priority): Runtime => {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string')
        return invalid(packet, 'executors');
      const [name, version] = entry as [string, unknown];
      return {
        language,
        name: clipBytes(name, MAX_NAME_LENGTH),
        version: clipBytes(versionText(packet, version), MAX_NAME_LENGTH),
        priority,
      };
    });
  });
  return {
    name: 'handshake',
    id: boundedText(packet, 'id', MAX_NAME_LENGTH),
    key: boundedText(packet, 'key', MAX_KEY_LENGTH),
    problems: problemCodes(packet),
    executors: Object.keys(executors),
    runtimes,
  };
}

function caseReport(packet: Packet, raw: unknown): CaseReport {
  if (typeof raw !== 'object' || raw === null) return invalid(packet, 'cases');
  const value = raw as Record<string, unknown>;
  if (
    !Number.isSafeInteger(value.position) ||
    (value.position as number) < 1 ||
    (value.position as number) > MAX_SUBMISSION_CASES ||
    !Number.isSafeInteger(value.status)
  )
    return invalid(packet, 'cases');
  return {
    position: value.position as number,
    status: caseStatusFromBitmask(value.status as number),
    time: measured(packet, value.time),
    memory: measured(packet, value.memory),
    points: measured(packet, value.points),
    total: measured(packet, value['total-points']),
    feedback: optionalText(value.feedback, MAX_CASE_FEEDBACK_LENGTH),
    extendedFeedback: optionalText(
      value['extended-feedback'],
      MAX_CASE_TEXT_LENGTH,
    ),
    output: optionalText(value.output, MAX_CASE_TEXT_LENGTH),
  };
}

function submissionPacket(packet: Packet): SubmissionPacket {
  const submissionId = boundedText(packet, 'submission-id', MAX_NAME_LENGTH);
  switch (packet.name) {
    case 'grading-begin':
      return {
        name: 'grading-begin',
        submissionId,
        pretested: packet.pretested === true,
      };
    case 'test-case-status': {
      const { cases } = packet;
      if (
        !Array.isArray(cases) ||
        !cases.length ||
        cases.length > MAX_SUBMISSION_CASES
      )
        return invalid(packet, 'cases');
      return {
        name: 'test-case-status',
        submissionId,
        cases: cases.map((raw: unknown) => caseReport(packet, raw)),
      };
    }
    case 'compile-error':
    case 'compile-message':
      return {
        name: packet.name,
        submissionId,
        log: clippedText(packet, 'log', MAX_LOG_LENGTH),
      };
    case 'internal-error':
      return {
        name: 'internal-error',
        submissionId,
        message: clippedText(packet, 'message', MAX_LOG_LENGTH),
      };
    default:
      return { name: packet.name, submissionId } as SubmissionPacket;
  }
}

/** Validates and normalises a judge → bridge packet. Unknown names are null (ignored, like legacy); a known packet with bad fields is a `ProtocolError`. */
export function parseJudgePacket(packet: Packet): JudgePacket | null {
  if (SUBMISSION_PACKETS.has(packet.name)) return submissionPacket(packet);
  switch (packet.name) {
    case 'handshake':
      return handshake(packet);
    case 'supported-problems':
      return { name: 'supported-problems', problems: problemCodes(packet) };
    case 'ping-response': {
      const { when, load } = packet;
      if (typeof when !== 'number' || !Number.isFinite(when))
        return invalid(packet, 'when');
      return {
        name: 'ping-response',
        when,
        load:
          typeof load === 'number' && Number.isFinite(load) && load >= 0
            ? load
            : null,
      };
    }
    default:
      return null;
  }
}

/** What `pickJudge`'s winner is sent; `SubmissionsRepository.claim` builds it. */
export interface SubmissionRequest {
  submissionId: string;
  /** The code the judge knows: a mirror's root code. */
  problemCode: string;
  languageKey: string;
  source: string;
  timeLimit: number;
  memoryLimit: number;
  shortCircuit: boolean;
  /** Contest submissions only: the pretests flag and the participation's `virtual` (`SubmissionsRepository.claim`). */
  pretestsOnly: boolean;
  inContest: number | null;
  attemptNo: number;
  userId: string;
  /** File-only languages are deferred: always false / 0 in 2a. */
  fileOnly: boolean;
  fileSizeLimit: number;
}

/** Legacy `JudgeHandler.submit` field names, which the judge-server fork reads. */
export const submissionRequestPacket = (
  request: SubmissionRequest,
): Packet => ({
  name: 'submission-request',
  'submission-id': request.submissionId,
  'problem-id': request.problemCode,
  language: request.languageKey,
  source: request.source,
  'time-limit': request.timeLimit,
  'memory-limit': request.memoryLimit,
  'short-circuit': request.shortCircuit,
  meta: {
    'pretests-only': request.pretestsOnly,
    'in-contest': request.inContest,
    'attempt-no': request.attemptNo,
    user: request.userId,
    'file-only': request.fileOnly,
    'file-size-limit': request.fileSizeLimit,
  },
});
