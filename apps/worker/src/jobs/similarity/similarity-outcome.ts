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

/** `maxPairs` bounds the whole run, not each group: the strongest of the kept and the added pairs, from any group. */
export const keepStrongest = (
  keptPairs: StoredPair[],
  addedPairs: StoredPair[],
  maxPairs: number,
): StoredPair[] =>
  keptPairs.concat(addedPairs).sort(strongestFirst).slice(0, maxPairs);

/** Each group's `pairCount`: how many of its pairs survived the run-wide cap. */
export const withKeptPairCounts = (
  groups: SimilarityGroup[],
  keptPairs: StoredPair[],
): SimilarityGroup[] => {
  const keptPerGroup = new Map<string, number>();
  for (const pair of keptPairs)
    keptPerGroup.set(
      groupKey(pair),
      (keptPerGroup.get(groupKey(pair)) ?? 0) + 1,
    );
  return groups.map((group) => ({
    ...group,
    pairCount: keptPerGroup.get(groupKey(group)) ?? 0,
  }));
};
