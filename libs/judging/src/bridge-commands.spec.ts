import { newId } from '@libs/database';
import type { BridgeCommand } from './bridge-commands';
import { JUDGE_COMMAND_BATCH, parseBridgeCommand } from './bridge-commands';

describe('parseBridgeCommand', () => {
  it.each<BridgeCommand>([
    {
      type: 'judge',
      submissionIds: [newId(), newId()],
      judgeName: null,
    },
    {
      type: 'judge',
      submissionIds: [newId()],
      judgeName: 'judge-01',
    },
    { type: 'abort', submissionId: newId() },
    { type: 'disconnect-judge', judgeName: 'judge-01', force: true },
    { type: 'disable-judge', judgeName: 'judge-01', isDisabled: false },
    { type: 'generate', generationId: newId() },
  ])('round-trips %j', (command) =>
    expect(parseBridgeCommand(JSON.stringify(command))).toEqual(command),
  );
  it('drops fields a judge command does not have', () =>
    expect(
      parseBridgeCommand(
        JSON.stringify({
          type: 'judge',
          submissionIds: [],
          judgeName: null,
          bannedJudges: ['x'],
        }),
      ),
    ).toEqual({ type: 'judge', submissionIds: [], judgeName: null }));
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
    }),
    JSON.stringify({
      type: 'judge',
      submissionIds: Array.from({ length: JUDGE_COMMAND_BATCH + 1 }, newId),
      judgeName: null,
    }),
    JSON.stringify({
      type: 'judge',
      submissionIds: [newId()],
      judgeName: 'a b',
    }),
    JSON.stringify({ type: 'judge', submissionIds: [newId()] }),
    JSON.stringify({ type: 'disconnect-judge', judgeName: 'a b', force: true }),
    JSON.stringify({ type: 'disable-judge', judgeName: 'judge-01' }),
    JSON.stringify({ type: 'generate', generationId: 'not-a-uuid' }),
  ])('ignores %s', (raw) => expect(parseBridgeCommand(raw)).toBeNull());
});
