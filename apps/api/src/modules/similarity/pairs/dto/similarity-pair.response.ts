import { uuidStr } from '@libs/database';
import type { SimilarityPair, SimilaritySide } from '@libs/database';

export class SimilaritySideResponse {
  submissionId!: string;
  userId!: string;
  username!: string;
}

/**
 * The fields the pair list and the pair detail share. Responses are built by
 * the functions below each class.
 */
export class SimilarityPairFieldsResponse {
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
}

export function pairFieldsResponse(
  pair: SimilarityPair,
  problemCode: string,
): SimilarityPairFieldsResponse {
  return {
    id: uuidStr(pair._id),
    runId: uuidStr(pair.run),
    problemId: uuidStr(pair.problem),
    problemCode,
    language: pair.language,
    similarity: pair.similarity,
    longestFragment: pair.longestFragment,
    totalOverlap: pair.totalOverlap,
  };
}

/** `usernames` maps user ids to usernames; a deleted user shows as ''. */
export function sideResponse(
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

export class SimilarityPairResponse extends SimilarityPairFieldsResponse {
  fragmentCount!: number;
  left!: SimilaritySideResponse;
  right!: SimilaritySideResponse;
}

export function pairResponse(
  pair: SimilarityPair,
  problemCode: string,
  usernames: Map<string, string>,
): SimilarityPairResponse {
  return {
    ...pairFieldsResponse(pair, problemCode),
    fragmentCount: pair.fragments.length,
    left: sideResponse(pair.left, usernames),
    right: sideResponse(pair.right, usernames),
  };
}
