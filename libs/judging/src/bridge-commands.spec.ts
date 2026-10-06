import { newId } from '@libs/database';
import type { BridgeCommand } from './bridge-commands';
import { JUDGE_COMMAND_BATCH, parseBridgeCommand } from './bridge-commands';

describe('parseBridgeCommand', () => {
  it.each<BridgeCommand>([
    {
      type: 'judge',
      submissionIds: [newId(), newId()],
      judgeName: null,
      bannedJudges: [],
    },
    {
      type: 'judge',
      submissionIds: [newId()],
      judgeName: 'judge-01',
      bannedJudges: ['judge-02'],
    },
    { type: 'abort', submissionId: newId() },
    { type: 'disconnect-judge', judgeName: 'judge-01', force: true },
    { type: 'disable-judge', judgeName: 'judge-01', isDisabled: false },
  ])('round-trips %j', (command) =>
    expect(parseBridgeCommand(JSON.stringify(command))).toEqual(command),
  );
  it.each([
    'not json',
    'null',
    '[]',
    JSON.stringify({ type: 'explode' }),
    JSON.stringify({ type: 'abort', submissionId: 'not-a-uuid' }),
    JSON.stringify({
      type: 'judge',
      submissionIds: ['1; drop'],
      judgeName: null,
      bannedJudges: [],
    }),
    JSON.stringify({
      type: 'judge',
      submissionIds: Array.from({ length: JUDGE_COMMAND_BATCH + 1 }, newId),
      judgeName: null,
      bannedJudges: [],
    }),
    JSON.stringify({
      type: 'judge',
      submissionIds: [newId()],
      judgeName: null,
      bannedJudges: ['a b'],
    }),
    JSON.stringify({ type: 'judge', submissionIds: [newId()] }),
    JSON.stringify({ type: 'disconnect-judge', judgeName: 'a b', force: true }),
    JSON.stringify({ type: 'disable-judge', judgeName: 'judge-01' }),
  ])('ignores %s', (raw) => expect(parseBridgeCommand(raw)).toBeNull());
});
