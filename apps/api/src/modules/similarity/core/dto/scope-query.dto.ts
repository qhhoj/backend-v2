import { IsOptional, IsString } from 'class-validator';

/** The scope of a start (body) or a list (query): exactly one of the two, checked in `SimilarityAccessService.targetOf`. */
export class ScopeQueryDto {
  /** Problem code. */
  @IsOptional() @IsString() problem?: string;
  /** Contest key. */
  @IsOptional() @IsString() contest?: string;
}
