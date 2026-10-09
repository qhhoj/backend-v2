import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PP_ENTRIES } from '@libs/judging';
import { IsTimeZone } from '../../core/dto/is-time-zone';

const PP_PAGE_SIZE_MAX = 100;

export class PpBreakdownQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PP_ENTRIES)
  page: number = 1;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PP_PAGE_SIZE_MAX)
  pageSize: number = 10;
}

export class ActivityQueryDto {
  @IsOptional() @IsTimeZone() timezone?: string;
}

export class UserCommentsQueryDto {
  @IsOptional() @IsUUID('7') before?: string;
}
