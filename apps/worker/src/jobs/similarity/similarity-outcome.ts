import type { SimilarityGroup } from '@libs/database';
import { DEFAULT_MAX_FRAGMENTS_PER_PAIR } from './similarity-engine';
import type {
  EnginePair,
  EngineSubmission,
  LineRange,
} from './similarity-engine';
import type { StoredPair } from './similarity.repository';

/** One (problem, language family) comparison: its summary and the pairs it found. */
export interface GroupComparison {
  group: SimilarityGroup;
  pairs: StoredPair[];
}

const groupKey = (entry: { problem: string; language: string }): string =>
  `${entry.problem}/${entry.language}`;

const strongestFirst = (first: StoredPair, second: StoredPair): number =>
  second.similarity - first.similarity || second.overlap - first.overlap;

const isWellFormed = (range: LineRange): boolean =>
  range.leftStart >= 1 &&
  range.rightStart >= 1 &&
  range.leftEnd >= range.leftStart &&
  range.rightEnd >= range.rightStart;

/** The viewer slices sources by these lines, so malformed ranges are dropped and the count capped. */
const storableFragments = (fragments: LineRange[]): LineRange[] =>
  fragments.filter(isWellFormed).slice(0, DEFAULT_MAX_FRAGMENTS_PER_PAIR);

/**
 * Engine pairs carry submission ids only; the users come from the submissions that were sent.
 * The stored invariants hold here whatever produced the pair (the engine already keeps them): never one user against
 * themself, and well-formed, capped line ranges. Dropping before the cap keeps every group's `pairCount` true.
 */
export const toStoredPairs = (
  group: SimilarityGroup,
  enginePairs: EnginePair[],
  submissions: EngineSubmission[],
): StoredPair[] => {
  const userOf = new Map(
    submissions.map((submission) => [submission.id, submission.user]),
  );
  return enginePairs
    .map((pair) => ({
      problem: group.problem,
      language: group.language,
      leftId: pair.leftId,
      rightId: pair.rightId,
      leftUser: userOf.get(pair.leftId)!,
      rightUser: userOf.get(pair.rightId)!,
      similarity: pair.similarity,
      longest: pair.longest,
      overlap: pair.overlap,
      fragments: storableFragments(pair.fragments),
    }))
    .filter((pair) => pair.leftUser !== pair.rightUser);
};

/** The pairs a run keeps so far, and per group how many the run-wide cap left out. */
export interface StrongestPairs {
  pairs: StoredPair[];
  cutPerGroup: Map<string, number>;
}

const userPairKey = (pair: StoredPair): string =>
  [pair.problem, ...[pair.leftUser, pair.rightUser].sort()].join('/');

/** One pair per problem and two users, the strongest: the language families of one problem are separate groups. */
const strongestPerUserPair = (pairs: StoredPair[]): StoredPair[] => {
  const strongest = new Map<string, StoredPair>();
  for (const pair of pairs) {
    const kept = strongest.get(userPairKey(pair));
    if (!kept || strongestFirst(pair, kept) < 0)
      strongest.set(userPairKey(pair), pair);
  }
  return [...strongest.values()];
};

const countPerGroup = (
  counts: Map<string, number>,
  pairs: StoredPair[],
): Map<string, number> => {
  const counted = new Map(counts);
  for (const pair of pairs)
    counted.set(groupKey(pair), (counted.get(groupKey(pair)) ?? 0) + 1);
  return counted;
};

/** `maxPairs` bounds the whole run, not each group: the strongest of the kept and the added pairs, from any group, one per problem and two users. */
export const keepStrongest = (
  kept: StrongestPairs,
  addedPairs: StoredPair[],
  maxPairs: number,
): StrongestPairs => {
  const ranked = strongestPerUserPair(kept.pairs.concat(addedPairs)).sort(
    strongestFirst,
  );
  return {
    pairs: ranked.slice(0, maxPairs),
    cutPerGroup: countPerGroup(kept.cutPerGroup, ranked.slice(maxPairs)),
  };
};

/** Each group's `pairCount`, how many of its pairs survived the run-wide cap, and `droppedByCap`, how many the engine's and the run's caps left out. */
export const withKeptPairCounts = (
  groups: SimilarityGroup[],
  strongest: StrongestPairs,
): SimilarityGroup[] => {
  const keptPerGroup = countPerGroup(new Map(), strongest.pairs);
  return groups.map((group) => ({
    ...group,
    pairCount: keptPerGroup.get(groupKey(group)) ?? 0,
    droppedByCap:
      group.droppedByCap + (strongest.cutPerGroup.get(groupKey(group)) ?? 0),
  }));
};
