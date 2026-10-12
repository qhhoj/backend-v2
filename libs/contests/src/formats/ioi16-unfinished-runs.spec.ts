import { batchMinima, ioi16Format } from './ioi16';
import { context, row } from './scoring-fixtures';

/** A run that did not grade its whole batch (AB, IE, still judging) earns no batch points: its stored cases are partial. */
describe('ioi16 ignores batch points of unfinished runs', () => {
  const problems = [{ problemId: 'P', points: 100, dataPoints: 100 }];
  // batch 1 = cases 1-3 worth 40; only case 1 (AC, 40) was reported before the run ended
  const partialCases = batchMinima([{ batch: 1, points: 40 }]);

  it.each([
    ['AB', 'AB'],
    ['IE', 'IE'],
    ['G', null],
  ] as const)('a %s row with a partial batch scores 0', (status, result) => {
    const score = ioi16Format.score(
      [row('P', 5, 0, { status, result, batchPoints: partialCases })],
      { cumtime: false },
      context({ problems }),
    );
    expect(score.score).toBe(0);
  });

  it('still credits the batch from a finished run', () => {
    const score = ioi16Format.score(
      [
        row('P', 5, 0, {
          status: 'AB',
          result: 'AB',
          batchPoints: partialCases,
        }),
        row('P', 6, 40, {
          status: 'D',
          result: 'WA',
          batchPoints: { '1': 40, '2': 0 },
        }),
      ],
      { cumtime: false },
      context({ problems }),
    );
    expect(score.score).toBe(40);
  });
});
