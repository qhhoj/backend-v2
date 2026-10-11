import { currentGhostGap, ghostGap } from './ghost-gap';
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
    ['ioi', {}, [cell({ points: 50 })], null],
    ['icpc', {}, [cell()], 'rejectedBefore'],
    ['icpc', {}, [cell({ rejectedBefore: 0 })], null],
    ['icpc', { penalty: 0 }, [cell()], null],
    ['default', {}, [cell()], null],
  ] as const)('%s %j needs %s', (name, config, cells, gap) =>
    expect(ghostGap({ name, config }, cells)).toBe(gap),
  );
});

describe('currentGhostGap', () => {
  it('ignores cells of problems no longer in the contest', () => {
    const icpc = { name: 'icpc', config: {} } as const;
    const cells = [
      cell({ problemId: 'gone' }),
      cell({ problemId: 'b', rejectedBefore: 0 }),
    ];
    expect(currentGhostGap(icpc, cells, new Set(['b']))).toBeNull();
    expect(currentGhostGap(icpc, cells, new Set(['b', 'gone']))).toBe(
      'rejectedBefore',
    );
  });
});
