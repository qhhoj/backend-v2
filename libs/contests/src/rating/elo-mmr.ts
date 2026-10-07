/** Legacy `judge/ratings.py` (Elo-MMR), ported line for line; goldens from the Python pin it. */
const BETA2 = 328.33 ** 2;
export const RATING_INIT = 1200;
export const MEAN_INIT = 1500;
const VAR_INIT = 200 ** 2 * (BETA2 / 212 ** 2);
const SD_INIT = Math.sqrt(VAR_INIT);
const VALID_RANGE: readonly [number, number] = [
  MEAN_INIT - 20 * SD_INIT,
  MEAN_INIT + 20 * SD_INIT,
];
const VAR_PER_CONTEST = 1219.047619 * (BETA2 / 212 ** 2);
const VAR_LIM =
  (Math.sqrt(VAR_PER_CONTEST ** 2 + 4 * BETA2 * VAR_PER_CONTEST) -
    VAR_PER_CONTEST) /
  2;
const SD_LIM = Math.sqrt(VAR_LIM);
const TANH_C = Math.sqrt(3) / Math.PI;

export type TanhTerm = readonly [
  mean: number,
  deviation: number,
  weight: number,
];
export interface RatingInput {
  /** `tieRanks` of the participant. */
  rank: number;
  /** Latest `Rating.mean`, `MEAN_INIT` for a newcomer. */
  mean: number;
  /** Earlier `Rating.performance` values, newest first. */
  history: readonly number[];
}
export interface RatingOutput {
  rating: number;
  mean: number;
  performance: number;
}

/** Legacy `tie_ranker` over rows already sorted best first. */
export function tieRanks<Row>(
  sorted: readonly Row[],
  same: (left: Row, right: Row) => boolean,
): number[] {
  const ranks: number[] = [];
  let start = 0;
  while (start < sorted.length) {
    let end = start + 1;
    while (end < sorted.length && same(sorted[start], sorted[end])) end += 1;
    const rank = start + 1 + (end - start - 1) / 2;
    for (let index = start; index < end; index += 1) ranks.push(rank);
    start = end;
  }
  return ranks;
}

/** Python 3 `round(x)`: halves go to the even neighbour. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction !== 0.5) return fraction > 0.5 ? floor + 1 : floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const evalTanhs = (terms: readonly TanhTerm[], point: number): number =>
  terms.reduce(
    (sum, [mean, deviation, weight]) =>
      sum + (weight / deviation) * Math.tanh((point - mean) / (2 * deviation)),
    0,
  );

/** Legacy `solve`: bisection down to a width of 2, then linear interpolation, clamped to the bounds. */
export function solve(
  terms: readonly TanhTerm[],
  target: number,
  linearFactor = 0,
  bounds: readonly [number, number] = VALID_RANGE,
): number {
  let [low, high] = bounds;
  let lowValue: number | null = null;
  let highValue: number | null = null;
  while (high - low > 2) {
    const middle = (low + high) / 2;
    const value = linearFactor * middle + evalTanhs(terms, middle);
    if (value > target) [high, highValue] = [middle, value];
    else if (value < target) [low, lowValue] = [middle, value];
    else return middle;
  }
  lowValue ??= linearFactor * low + evalTanhs(terms, low);
  if (target <= lowValue) return low;
  highValue ??= linearFactor * high + evalTanhs(terms, high);
  if (target >= highValue) return high;
  const ratio = (target - lowValue) / (highValue - lowValue);
  return low * (1 - ratio) + high * ratio;
}

const varianceCache = [VAR_INIT];
/** Legacy `get_var`: the variance after `timesRanked` contests. */
function varianceAfter(timesRanked: number): number {
  while (timesRanked >= varianceCache.length)
    varianceCache.push(
      1 /
        (1 / (varianceCache[varianceCache.length - 1] + VAR_PER_CONTEST) +
          1 / BETA2),
    );
  return varianceCache[timesRanked];
}

/** Legacy `recalculate_ratings`; inputs in ranking order. */
export function recalculateRatings(
  inputs: readonly RatingInput[],
): RatingOutput[] {
  const count = inputs.length;
  const timesRanked = inputs.map(({ history }) => history.length);
  // Legacy pre-multiplies delta by TANH_C.
  const delta = timesRanked.map(
    (times) =>
      TANH_C * Math.sqrt(varianceAfter(times) + VAR_PER_CONTEST + BETA2),
  );
  const performanceTerms: TanhTerm[] = inputs.map(({ mean }, index) => [
    mean,
    delta[index],
    1,
  ]);
  let performance: number[] = new Array<number>(count).fill(0);
  let mean: number[] = new Array<number>(count).fill(0);

  const solveIndex = (
    index: number,
    bounds: readonly [number, number] = VALID_RANGE,
  ) => {
    const rank = inputs[index].rank;
    let target = 0;
    inputs.forEach((other, otherIndex) => {
      if (other.rank > rank) target += 1 / delta[otherIndex];
      else if (other.rank < rank) target -= 1 / delta[otherIndex];
      // A tie counts as half a win (Elo-MMR).
    });
    performance[index] = solve(performanceTerms, target, 0, bounds);
  };
  // Performance never increases down the ranking, so each middle is bounded by its neighbours.
  const fill = (first: number, last: number) => {
    if (last - first <= 1) return;
    const middle = Math.floor((first + last) / 2);
    solveIndex(middle, [performance[last], performance[first]]);
    fill(first, middle);
    fill(middle, last);
  };

  if (count < 2) {
    performance = inputs.map((input) => input.mean);
    mean = inputs.map((input) => input.mean);
  } else {
    solveIndex(0);
    solveIndex(count - 1);
    fill(0, count - 1);
    inputs.forEach((input, index) => {
      const terms: TanhTerm[] = [];
      let previousWeight = 1;
      let weightSum = 0;
      [performance[index], ...input.history].forEach((value, historyIndex) => {
        const gamma2 = historyIndex > 0 ? VAR_PER_CONTEST : 0;
        const historyVariance = varianceAfter(
          timesRanked[index] + 1 - historyIndex,
        );
        const decay = historyVariance / (historyVariance + gamma2);
        const weight = previousWeight * decay ** 2;
        terms.push([value, Math.sqrt(BETA2) * TANH_C, weight]);
        previousWeight = weight;
        weightSum += weight / BETA2;
      });
      const baseWeight = 1 / varianceAfter(timesRanked[index] + 1) - weightSum;
      const basePerformance =
        evalTanhs(terms.slice(1), input.mean) / baseWeight + input.mean;
      mean[index] = solve(terms, baseWeight * basePerformance, baseWeight);
    });
  }
  // A slightly lower displayed rating rewards taking part; it converges to the mean.
  return inputs.map((_input, index) => ({
    rating: Math.max(
      1,
      roundHalfEven(
        mean[index] -
          (Math.sqrt(varianceAfter(timesRanked[index] + 1)) - SD_LIM),
      ),
    ),
    mean: mean[index],
    performance: performance[index],
  }));
}
