import goldens from './elo-mmr.goldens.json';
import {
  MEAN_INIT,
  recalculateRatings,
  roundHalfEven,
  solve,
  tieRanks,
} from './elo-mmr';
import type { TanhTerm } from './elo-mmr';

/** `Math.tanh` and libm may differ in the last bit; the bisection absorbs it. */
const CLOSE = 6;

describe('Elo-MMR', () => {
  it.each(goldens.ratings.map((golden) => [golden.name, golden] as const))(
    'matches the legacy Python on every golden case: %s',
    (_name, golden) => {
      const outputs = recalculateRatings(
        golden.inputs.map(({ rank, mean, history }) => ({
          rank,
          mean,
          history,
        })),
      );
      outputs.forEach((output, index) => {
        const expected = golden.outputs[index];
        expect(output.rating).toBe(expected.rating);
        expect(output.mean).toBeCloseTo(expected.mean, CLOSE);
        expect(output.performance).toBeCloseTo(expected.performance, CLOSE);
      });
    },
  );

  it.each(goldens.solves.map((golden, index) => [index, golden] as const))(
    'solves like the legacy bisection, clamps included (case %i)',
    (_index, golden) => {
      expect(
        solve(
          golden.terms as unknown as TanhTerm[],
          golden.target,
          golden.linearFactor,
          golden.bounds as [number, number],
        ),
      ).toBeCloseTo(golden.result, CLOSE);
    },
  );

  it.each(
    goldens.ties.map((golden) => [golden.keys.join(','), golden] as const),
  )('ranks ties like tie_ranker: %s', (_keys, golden) => {
    expect(tieRanks(golden.keys, (left, right) => left === right)).toEqual(
      golden.ranks,
    );
  });

  it('rounds halves to even like Python', () => {
    expect(
      [0.5, 1.5, 2.5, -0.5, -1.5, 2.4999, 2.5001].map(roundHalfEven),
    ).toEqual([0, 2, 2, 0, -2, 2, 3]);
  });

  it('never lets a better rank perform worse, and gives tied participants equal results', () => {
    const outputs = recalculateRatings(
      [1, 2.5, 2.5, 4].map((rank) => ({ rank, mean: MEAN_INIT, history: [] })),
    );
    expect(outputs[0].performance).toBeGreaterThan(outputs[1].performance);
    // Tied rows are solved inside different divide-and-conquer bounds, so equal up to the bisection.
    expect(outputs[1].performance).toBeCloseTo(outputs[2].performance, CLOSE);
    expect(outputs[1].rating).toBe(outputs[2].rating);
    expect(outputs[2].performance).toBeGreaterThan(outputs[3].performance);
  });

  it('leaves a lone participant at their mean', () => {
    const [output] = recalculateRatings([
      { rank: 1, mean: 1700, history: [1650] },
    ]);
    expect(output.mean).toBe(1700);
    expect(output.performance).toBe(1700);
  });
});
