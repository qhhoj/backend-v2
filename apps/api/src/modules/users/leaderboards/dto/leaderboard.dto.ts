import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { LEADERBOARD_FIELDS } from '@libs/database';
import type { LeaderboardField } from '@libs/database';

export const LEADERBOARD_PAGE_SIZE = 100;
/** Legacy `UserList.all_sorts`. */
export const USER_SORTS = [
  'rating',
  'performancePoints',
  'points',
  'problemCount',
  'contributionPoints',
] as const;
export type UserSort = (typeof USER_SORTS)[number];

export class ContributorListQueryDto {
  /** Page number, starting at 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Entries per page, 1-100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LEADERBOARD_PAGE_SIZE)
  pageSize: number = LEADERBOARD_PAGE_SIZE;
}

export class UserListQueryDto extends ContributorListQueryDto {
  /** Ranking field; ties share a rank. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(USER_SORTS)
  sort: UserSort = 'rating';
}

export class RankQueryDto {
  /** Leaderboard field to rank by. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(LEADERBOARD_FIELDS)
  sort: LeaderboardField = 'rating';
}
