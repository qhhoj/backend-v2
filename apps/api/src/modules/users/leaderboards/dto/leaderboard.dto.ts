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
] as const;
export type UserSort = (typeof USER_SORTS)[number];

export class ContributorListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LEADERBOARD_PAGE_SIZE)
  pageSize: number = LEADERBOARD_PAGE_SIZE;
}

export class UserListQueryDto extends ContributorListQueryDto {
  @IsOptional() @IsIn(USER_SORTS) sort: UserSort = 'rating';
}

export class RankQueryDto {
  @IsOptional() @IsIn(LEADERBOARD_FIELDS) sort: LeaderboardField = 'rating';
}
