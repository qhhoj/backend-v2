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
  MAX_FILTER_VALUES,
} from '../../problems/dto/api-v2-problem-list.dto';

/** Legacy `APIOrganizationList` filters. */
export class ApiV2OrganizationListDto {
  @IsOptional() @Transform(toBoolean) @IsBoolean() is_open?: boolean;
  @IsOptional()
  @Transform(toArray)
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID('7', { each: true })
  id?: string[];
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_V2_MAX_PAGE)
  page = 1;
}
