import { uuidStr } from '@libs/database';
import type { SimilarityPair, SimilaritySide } from '@libs/database';

export class SimilaritySideResponse {
  submissionId!: string;
  userId!: string;
  username!: string;

  /** `usernames` maps user ids to usernames; a deleted user shows as ''. */
  static from(
    side: SimilaritySide,
    usernames: Map<string, string>,
  ): SimilaritySideResponse {
    const userId = uuidStr(side.user);
    return {
      submissionId: uuidStr(side.submission),
      userId,
      username: usernames.get(userId) ?? '',
    };
  }
}

export class SimilarityPairResponse {
  id!: string;
  runId!: string;
  problemId!: string;
  problemCode!: string;
  /** Engine family. */
  language!: string;
  /** 0 to 1. */
  similarity!: number;
  /** Longest shared fragment, in k-grams. */
  longestFragment!: number;
  /** Shared k-grams over both files. */
  totalOverlap!: number;
  fragmentCount!: number;
  left!: SimilaritySideResponse;
  right!: SimilaritySideResponse;

  static from(
    pair: SimilarityPair,
    problemCode: string,
    usernames: Map<string, string>,
  ): SimilarityPairResponse {
    return {
      id: uuidStr(pair._id),
      runId: uuidStr(pair.run),
      problemId: uuidStr(pair.problem),
      problemCode,
      language: pair.language,
      similarity: pair.similarity,
      longestFragment: pair.longestFragment,
      totalOverlap: pair.totalOverlap,
      fragmentCount: pair.fragments.length,
      left: SimilaritySideResponse.from(pair.left, usernames),
      right: SimilaritySideResponse.from(pair.right, usernames),
    };
  }
}
