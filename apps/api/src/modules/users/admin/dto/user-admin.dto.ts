import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { toBoolean, trim } from '../../../problems/core/dto/transforms';

const STAFF_USER_PAGE_SIZE = 50;
const STAFF_USER_PAGE_SIZE_MAX = 100;
/** Skipping is linear in the page number, so deep pages are refused. */
const STAFF_USER_PAGE_MAX = 500;

export class UserAdminQueryDto {
  /** Case-insensitive username prefix; surrounding spaces are dropped. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  search?: string;
  /** True: banned users only. False: users who are not banned only. Unset: everyone. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() banned?: boolean;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STAFF_USER_PAGE_MAX)
  page: number = 1;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STAFF_USER_PAGE_SIZE_MAX)
  pageSize: number = STAFF_USER_PAGE_SIZE;
}
