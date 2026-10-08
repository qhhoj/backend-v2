import { ApiProperty, OmitType } from '@nestjs/swagger';
import type { SimilarityFragment } from '@libs/database';
import type { SubmissionFacts } from '../similarity-pairs.repository';
import {
  SimilarityPairResponse,
  SimilaritySideResponse,
} from './similarity-pair.response';

export class SimilarityFragmentResponse {
  /** 1-based, inclusive, in the left source. */
  leftStart!: number;
  leftEnd!: number;
  /** 1-based, inclusive, in the right source. */
  rightStart!: number;
  rightEnd!: number;

  static from(fragment: SimilarityFragment): SimilarityFragmentResponse {
    return {
      leftStart: fragment.leftStart,
      leftEnd: fragment.leftEnd,
      rightStart: fragment.rightStart,
      rightEnd: fragment.rightEnd,
    };
  }
}

export class SimilarityPairSourceResponse extends SimilaritySideResponse {
  /** Null when the submission no longer exists. */
  @ApiProperty({ type: Date, nullable: true })
  date!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  result!: string | null;
  @ApiProperty({ type: Number, nullable: true })
  points!: number | null;
  /** The code as submitted; empty when it no longer exists. */
  source!: string;

  /** A deleted submission keeps its side: null facts, empty source. */
  static withSource(
    side: SimilaritySideResponse,
    facts: SubmissionFacts | undefined,
    source: string | undefined,
  ): SimilarityPairSourceResponse {
    return {
      ...side,
      date: facts?.date ?? null,
      result: facts?.result ?? null,
      points: facts?.points ?? null,
      source: source ?? '',
    };
  }
}

/** The list row's fields, with each side's source and the fragments. */
export class SimilarityPairDetailResponse extends OmitType(
  SimilarityPairResponse,
  ['left', 'right'] as const,
) {
  left!: SimilarityPairSourceResponse;
  right!: SimilarityPairSourceResponse;
  /** Matched regions in left-file order, at most 50. */
  fragments!: SimilarityFragmentResponse[];

  static withSources(
    summary: SimilarityPairResponse,
    sides: {
      left: SimilarityPairSourceResponse;
      right: SimilarityPairSourceResponse;
    },
    fragments: SimilarityFragment[],
  ): SimilarityPairDetailResponse {
    return {
      ...summary,
      ...sides,
      fragments: fragments.map((fragment) =>
        SimilarityFragmentResponse.from(fragment),
      ),
    };
  }
}
