import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PP_ENTRIES } from '@libs/judging';
import { IsTimeZone } from '../../core/dto/is-time-zone';

const PP_PAGE_SIZE_MAX = 100;

export class PpBreakdownQueryDto {
  /** Page number, starting at 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PP_ENTRIES)
  page: number = 1;
  /** Entries per page, 1-100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PP_PAGE_SIZE_MAX)
  pageSize: number = 10;
}

export class ActivityQueryDto {
  /**
   * IANA time zone for the day boundaries; defaults to the viewer's profile zone, then UTC.
   */
  @IsOptional() @IsTimeZone() timezone?: string;
}

export class UserCommentsQueryDto {
  /** Id of the last comment of the previous page; returns older comments. */
  @IsOptional() @IsUUID('7') before?: string;
}
