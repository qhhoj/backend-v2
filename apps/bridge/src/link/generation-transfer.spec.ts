import { heldGeneration } from './generation-transfer';

describe('heldGeneration', () => {
  const holder = { id: 'session-1', generations: new Set(['gen-1']) };

  it.each([
    {
      name: 'the live session holding it',
      generationId: 'gen-1',
      sessionId: 'session-1',
      expected: true,
    },
    {
      name: 'another generation',
      generationId: 'gen-2',
      sessionId: 'session-1',
      expected: false,
    },
    {
      name: 'another session id',
      generationId: 'gen-1',
      sessionId: 'session-0',
      expected: false,
    },
    {
      name: 'an empty session id',
      generationId: 'gen-1',
      sessionId: '',
      expected: false,
    },
  ])('$name: $expected', ({ generationId, sessionId, expected }) => {
    expect(heldGeneration(holder, generationId, sessionId)).toBe(expected);
  });

  it('refuses a judge with no live session', () => {
    expect(heldGeneration(undefined, 'gen-1', 'session-1')).toBe(false);
  });
});
