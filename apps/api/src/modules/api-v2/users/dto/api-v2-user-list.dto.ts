import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { toArray } from '../../../problems/core/dto/transforms';
import {
  API_V2_MAX_PAGE,
  FilterStrings,
  MAX_FILTER_VALUES,
} from '../../core/api-v2-filters';

/** Legacy `APIUserList` filters. */
export class ApiV2UserListDto {
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID('7', { each: true })
  id?: string[];
  @FilterStrings() username?: string[];
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
