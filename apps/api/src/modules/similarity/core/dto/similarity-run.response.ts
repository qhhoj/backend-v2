import { ApiProperty } from '@nestjs/swagger';
import {
  SIMILARITY_ERRORS,
  SIMILARITY_SCOPES,
  SIMILARITY_STATUSES,
  SIMILARITY_TOKENIZERS,
  uuidStr,
} from '@libs/database';
import type {
  SimilarityError,
  SimilarityGroup,
  SimilarityRun,
  SimilarityScope,
  SimilarityStatus,
  SimilarityTokenizerName,
} from '@libs/database';

export class SimilarityLimitsResponse {
  minPercent!: number;
  maxPairs!: number;
  maxSubmissions!: number;
}

export class SimilarityGroupResponse {
  problemId!: string;
  problemCode!: string;
  /** Engine family: `cpp`, `python`, `pascal`, ... */
  language!: string;
  @ApiProperty({ enum: SIMILARITY_TOKENIZERS })
  tokenizer!: SimilarityTokenizerName;
  /** Submissions of the family in scope, before the cap. */
  submissionCount!: number;
  /** Actually compared, after the cap and the skips. */
  comparedCount!: number;
  skippedEmpty!: number;
  skippedTooLarge!: number;
  /** Only the newest `limits.maxSubmissions` were compared. */
  truncated!: boolean;
  pairCount!: number;
  /** The engine failed on this group alone: it has no pairs, the rest of the run completed. */
  failed!: boolean;
}

export class SimilarityUnsupportedResponse {
  /** The judge language's common name. */
  language!: string;
  submissionCount!: number;
}

const optionalId = (id: string | null) => (id === null ? null : uuidStr(id));

function groupResponse(
  group: SimilarityGroup,
  problemCodes: Map<string, string>,
): SimilarityGroupResponse {
  const problemId = uuidStr(group.problem);
  return {
    problemId,
    problemCode: problemCodes.get(problemId) ?? '',
    language: group.language,
    tokenizer: group.tokenizer,
    submissionCount: group.submissionCount,
    comparedCount: group.comparedCount,
    skippedEmpty: group.skippedEmpty,
    skippedTooLarge: group.skippedTooLarge,
    truncated: group.truncated,
    pairCount: group.pairCount,
    failed: group.failed,
  };
}

export class SimilarityRunResponse {
  id!: string;
  @ApiProperty({ enum: SIMILARITY_SCOPES })
  scope!: SimilarityScope;
  @ApiProperty({ type: String, nullable: true })
  problemId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  contestId!: string | null;
  @ApiProperty({ enum: SIMILARITY_STATUSES })
  status!: SimilarityStatus;
  @ApiProperty({ enum: SIMILARITY_ERRORS, nullable: true })
  error!: SimilarityError | null;
  createdAt!: Date;
  @ApiProperty({ type: Date, nullable: true })
  startedAt!: Date | null;
  @ApiProperty({ type: Date, nullable: true })
  finishedAt!: Date | null;
  limits!: SimilarityLimitsResponse;
  groups!: SimilarityGroupResponse[];
  unsupported!: SimilarityUnsupportedResponse[];

  /** `problemCodes` maps the groups' problem ids to codes. */
  static from(
    run: SimilarityRun,
    problemCodes: Map<string, string>,
  ): SimilarityRunResponse {
    return {
      id: uuidStr(run._id),
      scope: run.scope,
      problemId: optionalId(run.problem),
      contestId: optionalId(run.contest),
      status: run.status,
      error: run.error,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      limits: {
        minPercent: run.limits.minPercent,
        maxPairs: run.limits.maxPairs,
        maxSubmissions: run.limits.maxSubmissions,
      },
      groups: run.groups.map((group) => groupResponse(group, problemCodes)),
      unsupported: run.unsupported.map((entry) => ({
        language: entry.language,
        submissionCount: entry.submissionCount,
      })),
    };
  }
}
