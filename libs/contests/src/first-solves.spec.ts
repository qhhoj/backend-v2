import { problemSummaries } from './first-solves';
import type { SolveRow } from './first-solves';

const problems = [{ problemId: 'P', points: 100 }];
const rows: SolveRow[] = [
  {
    participationId: 'slow',
    virtual: 0,
    cells: { P: { points: 100, time: 100 } },
  },
  {
    participationId: 'fast',
    virtual: 0,
    cells: { P: { points: 100, time: 50 } },
  },
  {
    participationId: 'tied',
    virtual: 0,
    cells: { P: { points: 100, time: 50 } },
  },
  {
    participationId: 'virtual',
    virtual: 1,
    cells: { P: { points: 100, time: 10 } },
  },
  {
    participationId: 'partial',
    virtual: 0,
    cells: { P: { points: 60, time: 1 } },
  },
  { participationId: 'absent', virtual: 0, cells: {} },
];

describe('problemSummaries (legacy get_first_solves_and_total_ac)', () => {
  it('counts full-point cells and credits the earliest live solve, the first row winning a tie', () =>
    expect(
      problemSummaries({ name: 'default', config: {} }, problems, rows).get(
        'P',
      ),
    ).toEqual({
      firstSolve: 'fast',
      acceptedCount: 4,
    }));

  it('credits no first solve when the format shows no solve times', () => {
    for (const format of [
      { name: 'ioi' as const, config: {} },
      { name: 'final_submission' as const, config: {} },
    ])
      expect(problemSummaries(format, problems, rows).get('P')).toEqual({
        firstSolve: null,
        acceptedCount: 4,
      });
  });

  it('skips frozen cells without a time', () =>
    expect(
      problemSummaries({ name: 'icpc', config: {} }, problems, [
        {
          participationId: 'hidden',
          virtual: 0,
          cells: { P: { points: 100, time: null, tries: 1, pending: true } },
        },
        {
          participationId: 'shown',
          virtual: 0,
          cells: { P: { points: 100, time: 900, tries: 1, pending: false } },
        },
      ]).get('P'),
    ).toEqual({ firstSolve: 'shown', acceptedCount: 2 }));
});

describe('problemSummaries edge cases', () => {
  const live = (participationId: string, time: number, points = 100) => ({
    participationId,
    virtual: 0,
    cells: { P: { points, time } },
  });

  it('credits nobody when only virtual or partial cells exist, and counts for an empty board', () => {
    const onlyVirtual = [{ ...live('v', 5), virtual: 2 }, live('p', 1, 99)];
    expect(
      problemSummaries(
        { name: 'default', config: {} },
        problems,
        onlyVirtual,
      ).get('P'),
    ).toEqual({
      firstSolve: null,
      acceptedCount: 1,
    });
    expect(
      problemSummaries({ name: 'default', config: {} }, problems, []).get('P'),
    ).toEqual({
      firstSolve: null,
      acceptedCount: 0,
    });
  });

  it('credits the earliest solve whatever the row order, a later row not stealing an equal time', () => {
    const summary = (order: ReturnType<typeof live>[]) =>
      problemSummaries({ name: 'ultimate', config: {} }, problems, order).get(
        'P',
      )!;
    expect(summary([live('b', 7), live('a', 3), live('c', 3)]).firstSolve).toBe(
      'a',
    );
    expect(summary([live('c', 3), live('a', 3), live('b', 7)]).firstSolve).toBe(
      'c',
    );
  });

  it('credits a zero solve time and fractional times', () =>
    expect(
      problemSummaries({ name: 'default', config: {} }, problems, [
        live('a', 0.75),
        live('b', 0.5),
        live('z', 0),
      ]).get('P')!.firstSolve,
    ).toBe('z'));

  it('shows ioi times only with cumtime or lastScoreAltering', () => {
    const summary = (config: object) =>
      problemSummaries({ name: 'ioi', config }, problems, [
        live('a', 9),
        live('b', 4),
      ]).get('P')!.firstSolve;
    expect(summary({})).toBeNull();
    expect(summary({ cumtime: true })).toBe('b');
    expect(summary({ lastScoreAltering: true })).toBe('b');
  });

  it('summarises each problem separately', () => {
    const two = [
      { problemId: 'P', points: 100 },
      { problemId: 'Q', points: 10 },
    ];
    const board = [
      {
        participationId: 'a',
        virtual: 0,
        cells: { P: { points: 100, time: 9 }, Q: { points: 10, time: 5 } },
      },
      {
        participationId: 'b',
        virtual: 0,
        cells: { P: { points: 100, time: 3 }, Q: { points: 9, time: 1 } },
      },
    ];
    const summaries = problemSummaries(
      { name: 'default', config: {} },
      two,
      board,
    );
    expect(summaries.get('P')).toEqual({ firstSolve: 'b', acceptedCount: 2 });
    expect(summaries.get('Q')).toEqual({ firstSolve: 'a', acceptedCount: 1 });
  });
});
