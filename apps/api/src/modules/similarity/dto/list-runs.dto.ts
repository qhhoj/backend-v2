import { IsOptional, IsString } from 'class-validator';

/** Exactly one of the two (checked in `SimilarityAccessService.targetOf`). */
export class ListSimilarityRunsDto {
  /** Problem code. */
  @IsOptional() @IsString() problem?: string;
  /** Contest key. */
  @IsOptional() @IsString() contest?: string;
}
