import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { toArray, toBoolean } from '../../../problems/core/dto/transforms';
import {
  API_V2_MAX_PAGE,
  FilterStrings,
  MAX_FILTER_VALUES,
} from '../../core/api-v2-filters';

/** Legacy `APIContestList` filters. */
export class ApiV2ContestListDto {
  @IsOptional() @Transform(toBoolean) @IsBoolean() is_rated?: boolean;
  @FilterStrings() key?: string[];
  @FilterStrings() tag?: string[];
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID('7', { each: true })
  organization?: string[];
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_V2_MAX_PAGE)
  page = 1;
}
