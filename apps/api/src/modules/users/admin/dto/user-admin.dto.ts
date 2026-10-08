import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { toBoolean } from '../../../problems/core/dto/transforms';

const STAFF_USER_PAGE_SIZE = 50;
const STAFF_USER_PAGE_SIZE_MAX = 100;

export class UserAdminQueryDto {
  /** Case-insensitive username prefix. */
  @IsOptional() @IsString() @Length(1, 64) search?: string;
  @IsOptional() @Transform(toBoolean) @IsBoolean() banned?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STAFF_USER_PAGE_SIZE_MAX)
  pageSize = STAFF_USER_PAGE_SIZE;
}
