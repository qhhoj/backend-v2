/** Legacy `judge/utils/ranker.py`: competition ranks (1, 1, 3) over rows sorted best first, a row tying with the one before it when `same` says so. `firstRank` is the first row's rank (rows strictly above it, plus one), so page 2 continues page 1 instead of restarting at the page offset. */
export function competitionRanks<Row>(
  sorted: readonly Row[],
  same: (previous: Row, row: Row) => boolean,
  firstRank = 1,
): number[] {
  let rank = firstRank;
  return sorted.map((row, index) => {
    if (index > 0 && !same(sorted[index - 1], row)) rank = firstRank + index;
    return rank;
  });
}
