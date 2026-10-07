/** Legacy `judge/utils/ranker.py`: competition ranks (1, 1, 3) over values sorted best first; `firstRank` is the first value's rank (rows strictly above it, plus one), so page 2 continues page 1 instead of restarting at the page offset. */
export function competitionRanks<Value>(
  values: readonly Value[],
  firstRank: number,
): number[] {
  let rank = firstRank;
  return values.map((value, index) => {
    if (index > 0 && value !== values[index - 1]) rank = firstRank + index;
    return rank;
  });
}

/** Rows ranked above `value` on a descending `field`; null sorts last, so every non-null value is above it. */
export const strictlyAbove = (
  field: string,
  value: number | null,
): Record<string, unknown> =>
  value === null ? { [field]: { $ne: null } } : { [field]: { $gt: value } };
