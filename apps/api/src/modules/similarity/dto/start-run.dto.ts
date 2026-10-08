import { IsOptional, IsString } from 'class-validator';

/** Exactly one of the two (checked in `SimilarityAccessService.targetOf`). */
export class StartSimilarityRunDto {
  /** Problem code. */
  @IsOptional() @IsString() problem?: string;
  /** Contest key. */
  @IsOptional() @IsString() contest?: string;
}
