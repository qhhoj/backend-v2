import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { toBoolean, trim } from '../../../problems/core/dto/transforms';

export const STAFF_USER_SORTS = ['lastAccess', '-lastAccess'] as const;
export type StaffUserSort = (typeof STAFF_USER_SORTS)[number];

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
  /** `lastAccess` oldest first, `-lastAccess` most recent first; users who never visited sort as the oldest. Unset: a search by username, otherwise newest account first. */
  @ApiPropertyOptional({ enum: STAFF_USER_SORTS, enumName: 'StaffUserSort' })
  @IsOptional()
  @IsIn(STAFF_USER_SORTS)
  sort?: StaffUserSort;
  /** Page number, starting at 1 (up to 500). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STAFF_USER_PAGE_MAX)
  page: number = 1;
  /** Users per page, 1-100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STAFF_USER_PAGE_SIZE_MAX)
  pageSize: number = STAFF_USER_PAGE_SIZE;
}
