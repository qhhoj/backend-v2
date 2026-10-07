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

export class ApiV2ProblemListDto {
  @IsOptional() @Transform(toBoolean) @IsBoolean() partial?: boolean;
  @FilterStrings() code?: string[];
  @FilterStrings() group?: string[];
  @FilterStrings() type?: string[];
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID('7', { each: true })
  organization?: string[];
  @FilterStrings() search?: string[];
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_V2_MAX_PAGE)
  page = 1;
}
