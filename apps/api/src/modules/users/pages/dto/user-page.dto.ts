import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PP_ENTRIES } from '@libs/judging';
import { IsTimeZone } from '../../core/dto/is-time-zone';

const PP_PAGE_SIZE_MAX = 100;

export class PpBreakdownQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(PP_ENTRIES) page = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PP_PAGE_SIZE_MAX)
  pageSize = 10;
}

export class ActivityQueryDto {
  @IsOptional() @IsTimeZone() timezone?: string;
}

export class UserCommentsQueryDto {
  @IsOptional() @IsUUID('7') before?: string;
}
