import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toArray, toBoolean } from '../../problems/dto/transforms';

export const API_V2_MAX_PAGE = 10000;
const MAX_FILTER_VALUES = 100;
const MAX_FILTER_LENGTH = 100;
const NO_NUL = /^[^\0]*$/;

/** Every repeatable filter is a bounded array of NUL-free strings, never an object (no Mongo operators). */
export const FilterStrings = () => (target: object, key: string) => {
  Transform(toArray)(target, key);
  ArrayMaxSize(MAX_FILTER_VALUES)(target, key);
  IsString({ each: true })(target, key);
  MaxLength(MAX_FILTER_LENGTH, { each: true })(target, key);
  Matches(NO_NUL, { each: true })(target, key);
  IsOptional()(target, key);
};

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
