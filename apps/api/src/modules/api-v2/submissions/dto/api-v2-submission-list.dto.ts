import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  API_V2_MAX_PAGE,
  FilterStrings,
} from '../../problems/dto/api-v2-problem-list.dto';

/** Legacy `APISubmissionList` filters; `id` is not offered (ids are UUIDs) and, like every unknown key, ignored. */
export class ApiV2SubmissionListDto {
  /** Username. */
  @IsOptional() @IsString() @MaxLength(30) user?: string;
  /** Problem code. */
  @IsOptional() @IsString() @MaxLength(32) problem?: string;
  /** Language keys. */
  @FilterStrings() language?: string[];
  @FilterStrings() result?: string[];
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_V2_MAX_PAGE)
  page = 1;
}
