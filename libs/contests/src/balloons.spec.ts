import { balloonItems } from './balloons';
import type { SolveRow } from './first-solves';

const PROBLEMS = [
  { problemId: 'a', points: 100 },
  { problemId: 'b', points: 100 },
];
const ICPC = { name: 'icpc' as const, config: {} };
const solved = (time: number) => ({ time, points: 100, tries: 1 });
const row = (participationId: string, cells: SolveRow['cells']): SolveRow => ({
  participationId,
  virtual: 0,
  cells,
});

describe('balloonItems', () => {
  const rows = [
    row('ann', { a: solved(600) }),
    row('bob', { a: solved(900), b: solved(1200) }),
    row('cy', { a: { time: 300, points: 50, tries: 2 }, b: solved(1200) }),
  ];

  it('lists each solved cell once, earliest first, ties by problem order then team', () => {
    expect(
      balloonItems(ICPC, PROBLEMS, rows).map((item) => [
        item.participationId,
        item.problemId,
        item.solvedAt,
      ]),
    ).toEqual([
      ['ann', 'a', 600],
      ['bob', 'a', 900],
      ['bob', 'b', 1200],
      ['cy', 'b', 1200],
    ]);
  });

  it('flags the earliest solver of each problem as first, and a tie goes to the row listed first', () => {
    const items = balloonItems(ICPC, PROBLEMS, rows);
    expect(
      items
        .filter((item) => item.isFirst)
        .map((item) => [item.participationId, item.problemId]),
    ).toEqual([
      ['ann', 'a'],
      ['bob', 'b'],
    ]);
  });

  it('moves the first flag to the next solver when the earliest solve disappears, as after a rescore', () => {
    const afterRescore = [row('ann', {}), ...rows.slice(1)];
    const first = balloonItems(ICPC, PROBLEMS, afterRescore).filter(
      (item) => item.isFirst,
    );
    expect(first.map((item) => [item.participationId, item.problemId])).toEqual(
      [
        ['bob', 'a'],
        ['bob', 'b'],
      ],
    );
  });

  it('flags nobody in a format that shows no solve times, but still lists the solves', () => {
    const items = balloonItems({ name: 'ioi', config: {} }, PROBLEMS, [
      row('ann', { a: solved(600) }),
    ]);
    expect(items).toEqual([
      { participationId: 'ann', problemId: 'a', solvedAt: 600, isFirst: false },
    ]);
  });

  it('gives no balloon for a 0-point problem', () =>
    expect(
      balloonItems(
        ICPC,
        [{ problemId: 'a', points: 0 }],
        [row('ann', { a: { time: 600, points: 0, tries: 1 } })],
      ),
    ).toEqual([]));

  it('puts a solve with no known time after the timed ones', () => {
    const items = balloonItems({ name: 'ioi16', config: {} }, PROBLEMS, [
      row('ann', { a: { points: 100 } }),
      row('bob', { a: { time: 5, points: 100 } }),
    ]);
    expect(items.map((item) => [item.participationId, item.solvedAt])).toEqual([
      ['bob', 5],
      ['ann', null],
    ]);
  });
});
