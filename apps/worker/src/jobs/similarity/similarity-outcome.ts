import type { SimilarityGroup } from '@libs/database';
import type { EnginePair, EngineSubmission } from './similarity-engine';
import type { RunOutcome, StoredPair } from './similarity.repository';

/** One (problem, language family) comparison, before the run-wide pair cap. */
export interface GroupResult {
  group: SimilarityGroup;
  pairs: StoredPair[];
}

const groupKey = (entry: { problem: string; language: string }): string =>
  `${entry.problem}/${entry.language}`;

const strongestFirst = (first: StoredPair, second: StoredPair): number =>
  second.similarity - first.similarity || second.overlap - first.overlap;

/** Engine pairs carry submission ids only; the users come from the submissions that were sent. */
export const toStoredPairs = (
  group: SimilarityGroup,
  enginePairs: EnginePair[],
  submissions: EngineSubmission[],
): StoredPair[] => {
  const userOf = new Map(
    submissions.map((submission) => [submission.id, submission.user]),
  );
  return enginePairs.map((pair) => ({
    problem: group.problem,
    language: group.language,
    leftId: pair.leftId,
    rightId: pair.rightId,
    leftUser: userOf.get(pair.leftId)!,
    rightUser: userOf.get(pair.rightId)!,
    similarity: pair.similarity,
    longest: pair.longest,
    overlap: pair.overlap,
    fragments: pair.fragments,
  }));
};

/** `maxPairs` bounds the whole run, not each group: the strongest pairs of any group are kept, and each group counts what it kept. */
export const keepStrongestPairs = (
  results: GroupResult[],
  maxPairs: number,
): Pick<RunOutcome, 'groups' | 'pairs'> => {
  const pairs = results
    .flatMap((result) => result.pairs)
    .sort(strongestFirst)
    .slice(0, maxPairs);
  const keptPerGroup = new Map<string, number>();
  for (const pair of pairs)
    keptPerGroup.set(
      groupKey(pair),
      (keptPerGroup.get(groupKey(pair)) ?? 0) + 1,
    );
  const groups = results.map(({ group }) => ({
    ...group,
    pairCount: keptPerGroup.get(groupKey(group)) ?? 0,
  }));
  return { groups, pairs };
};
