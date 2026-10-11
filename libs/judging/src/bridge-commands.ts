import { isUuid, JUDGE_NAME_PATTERN } from '@libs/database';

/** API → bridge, fire-and-forget (`XADD`); the bridge reads it with `XREAD BLOCK`. */
export const BRIDGE_COMMANDS_STREAM = 'bridge:commands';
/** Approximate cap (`MAXLEN ~`): the bridge reads within milliseconds, and its periodic Mongo resync covers anything trimmed or lost. */
export const BRIDGE_COMMANDS_MAX_LENGTH = 10000;
/** Ids per `judge` command, so a bulk rejudge never builds one huge stream entry. */
export const JUDGE_COMMAND_BATCH = 1000;

export type BridgeCommand =
  | {
      type: 'judge';
      submissionIds: string[];
      /** Only this judge may take them (submit with `judgeId`). */
      judgeName: string | null;
      /** Contest hook (sub-project 4); always empty in 2a. */
      bannedJudges: string[];
    }
  | { type: 'abort'; submissionId: string }
  | { type: 'disconnect-judge'; judgeName: string; force: boolean }
  | { type: 'disable-judge'; judgeName: string; isDisabled: boolean }
  /** A queued `TestGeneration` row for the bridge to dispatch to a judge with feature `generate.polygon`. */
  | { type: 'generate'; generationId: string };

const isJudgeName = (value: unknown): value is string =>
  typeof value === 'string' && JUDGE_NAME_PATTERN.test(value);
const isIdList = (value: unknown, maxLength: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= maxLength &&
  value.every((item) => typeof item === 'string' && isUuid(item));

/** Stream entries come from our own api but are still checked before the bridge casts ids into queries; null = ignore. */
// eslint-disable-next-line complexity -- essential: one switch over the bridge commands, each validated in place
export function parseBridgeCommand(raw: string): BridgeCommand | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const command = value as Record<string, unknown>;
  switch (command.type) {
    case 'judge':
      return isIdList(command.submissionIds, JUDGE_COMMAND_BATCH) &&
        (command.judgeName === null || isJudgeName(command.judgeName)) &&
        Array.isArray(command.bannedJudges) &&
        command.bannedJudges.every(isJudgeName)
        ? (command as BridgeCommand)
        : null;
    case 'abort':
      return typeof command.submissionId === 'string' &&
        isUuid(command.submissionId)
        ? (command as BridgeCommand)
        : null;
    case 'disconnect-judge':
      return isJudgeName(command.judgeName) &&
        typeof command.force === 'boolean'
        ? (command as BridgeCommand)
        : null;
    case 'disable-judge':
      return isJudgeName(command.judgeName) &&
        typeof command.isDisabled === 'boolean'
        ? (command as BridgeCommand)
        : null;
    case 'generate':
      return typeof command.generationId === 'string' &&
        isUuid(command.generationId)
        ? (command as BridgeCommand)
        : null;
    default:
      return null;
  }
}
