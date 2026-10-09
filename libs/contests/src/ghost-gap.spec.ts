import { ghostGap } from './ghost-gap';
import type { GhostCell } from './ghost-types';

const cell = (extra: Partial<GhostCell> = {}): GhostCell => ({
  problemId: 'a',
  minute: 10,
  rejectedBefore: null,
  points: null,
  ...extra,
});

describe('ghostGap', () => {
  it.each([
    ['ioi', {}, [cell()], 'points'],
    ['ioi16', {}, [cell({ points: 50 }), cell({ problemId: 'b' })], 'points'],
    ['ioi', {}, [cell({ points: 50 })], null],
    ['icpc', {}, [cell()], 'rejectedBefore'],
    ['vnoj', { penalty: 10, lso: false }, [cell()], 'rejectedBefore'],
    ['icpc', { penalty: 20 }, [cell({ rejectedBefore: 0 })], null],
    ['icpc', { penalty: 0 }, [cell()], null],
    ['default', {}, [cell()], null],
    ['ultimate', {}, [cell()], null],
    ['icpc', {}, [], null],
  ] as const)('%s %j needs %s', (name, config, cells, gap) =>
    expect(ghostGap({ name, config }, cells)).toBe(gap),
  );
});
