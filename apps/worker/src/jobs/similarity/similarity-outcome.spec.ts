import type { SimilarityGroup } from '@libs/database';
import type { EnginePair, EngineSubmission } from './similarity-engine';
import {
  keepStrongest,
  toStoredPairs,
  withKeptPairCounts,
} from './similarity-outcome';
import type { StrongestPairs } from './similarity-outcome';

const groupOf = (problem: string, droppedByCap = 0): SimilarityGroup => ({
  problem,
  language: 'cpp',
  tokenizer: 'syntax',
  submissionCount: 0,
  comparedCount: 0,
  skippedEmpty: 0,
  skippedTooLarge: 0,
  truncated: false,
  pairCount: 0,
  droppedByCap,
  failed: false,
});
const submissionsOf = (user: string, count: number): EngineSubmission[] =>
  Array.from({ length: count }, (_item, index) => ({
    id: `${user}${index}`,
    user,
    source: '',
  }));
const pairOf = (
  left: EngineSubmission,
  right: EngineSubmission,
  similarity: number,
): EnginePair => ({
  leftId: left.id,
  rightId: right.id,
  similarity,
  longest: 10,
  overlap: 20,
  fragments: [],
});

describe('run-wide pair cap', () => {
  const resubmitters = [
    ...submissionsOf('ann', 50),
    ...submissionsOf('bob', 50),
  ];
  const copiers = [...submissionsOf('cat', 1), ...submissionsOf('dan', 1)];
  /** p1: ann and bob, 50 submissions each, every pair identical; p2: one cat/dan copy, and 3 pairs its engine run already left out. */
  const countsOfRun = (maxPairs: number): number[][] => {
    const groups = [groupOf('p1'), groupOf('p2', 3)];
    const resubmitted = resubmitters
      .slice(0, 50)
      .flatMap((left) =>
        resubmitters.slice(50).map((right) => pairOf(left, right, 1)),
      );
    const copied = [pairOf(copiers[0], copiers[1], 0.9)];
    let strongest: StrongestPairs = { pairs: [], cutPerGroup: new Map() };
    strongest = keepStrongest(
      strongest,
      toStoredPairs(groups[0], resubmitted, resubmitters),
      maxPairs,
    );
    strongest = keepStrongest(
      strongest,
      toStoredPairs(groups[1], copied, copiers),
      maxPairs,
    );
    return withKeptPairCounts(groups, strongest).map((group) => [
      group.pairCount,
      group.droppedByCap,
    ]);
  };

  it('keeps one pair per problem and two users, however often they submitted', () => {
    expect(countsOfRun(2)).toEqual([
      [1, 0],
      [1, 3],
    ]);
  });

  it('adds the pairs the run-wide cap left out to the group engine count', () => {
    expect(countsOfRun(1)).toEqual([
      [1, 0],
      [0, 4],
    ]);
  });
});
