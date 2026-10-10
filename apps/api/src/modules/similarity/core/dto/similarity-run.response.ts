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
  /** Pairs below this similarity percentage are dropped. */
  minPercent!: number;
  /** Most pairs kept per run. */
  maxPairs!: number;
  /** Most submissions compared per problem and language; the newest are kept. */
  maxSubmissions!: number;
}

export class SimilarityGroupResponse {
  /** Problem id. */
  problemId!: string;
  /** Problem code. */
  problemCode!: string;
  /** Engine family: `cpp`, `python`, `pascal`, ... */
  language!: string;
  /** How sources were tokenized: `syntax` (language-aware) or `text` (plain text). */
  @ApiProperty({ enum: SIMILARITY_TOKENIZERS })
  tokenizer!: SimilarityTokenizerName;
  /** Submissions of the family in scope, before the cap. */
  submissionCount!: number;
  /** Actually compared, after the cap and the skips. */
  comparedCount!: number;
  /** Submissions skipped because their source is empty. */
  skippedEmpty!: number;
  /** Submissions skipped because their source is too large. */
  skippedTooLarge!: number;
  /** Only the newest `limits.maxSubmissions` were compared. */
  truncated!: boolean;
  /** Pairs found in this group. */
  pairCount!: number;
  /** The engine failed on this group alone: it has no pairs, the rest of the run completed. */
  failed!: boolean;

  /** `problemCodes` maps problem ids to codes. */
  static from(
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
}

export class SimilarityUnsupportedResponse {
  /** The judge language's common name. */
  language!: string;
  /** Submissions in a language that cannot be compared. */
  submissionCount!: number;
}

const optionalId = (id: string | null) => (id === null ? null : uuidStr(id));

export class SimilarityRunResponse {
  /** Run id. */
  id!: string;
  /** `problem` or `contest`. */
  @ApiProperty({ enum: SIMILARITY_SCOPES })
  scope!: SimilarityScope;
  /** Problem id for a problem run; null otherwise. */
  @ApiProperty({ type: String, nullable: true })
  problemId!: string | null;
  /** Contest id for a contest run; null otherwise. */
  @ApiProperty({ type: String, nullable: true })
  contestId!: string | null;
  /** `queued`, `running`, `done` or `failed`. */
  @ApiProperty({ enum: SIMILARITY_STATUSES })
  status!: SimilarityStatus;
  /** Why a failed run failed: `deadline`, `engine_failed`, `internal_error` or `abandoned`; null otherwise. */
  @ApiProperty({ enum: SIMILARITY_ERRORS, nullable: true })
  error!: SimilarityError | null;
  /** When the run was requested. */
  createdAt!: Date;
  /** When the job started; null while queued. */
  @ApiProperty({ type: Date, nullable: true })
  startedAt!: Date | null;
  /** When the run ended; null while unfinished. */
  @ApiProperty({ type: Date, nullable: true })
  finishedAt!: Date | null;
  /** Limits that were in force when the run started. */
  limits!: SimilarityLimitsResponse;
  /** Compared groups, one per problem and language family. */
  groups!: SimilarityGroupResponse[];
  /** Languages whose submissions were not compared. */
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
      groups: run.groups.map((group) =>
        SimilarityGroupResponse.from(group, problemCodes),
      ),
      unsupported: run.unsupported.map((entry) => ({
        language: entry.language,
        submissionCount: entry.submissionCount,
      })),
    };
  }
}
