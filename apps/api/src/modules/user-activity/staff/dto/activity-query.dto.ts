import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ACTIVITY_DAYS_DEFAULT, ACTIVITY_DAYS_MAX } from '@libs/community';

export class ActivityPageQueryDto {
  /** Page number, 1-200. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  page: number = 1;
}

export class ActivityDaysQueryDto {
  /** How many days back to look, 1-90; default 7. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_DAYS_MAX)
  days: number = ACTIVITY_DAYS_DEFAULT;
}

/** The summary looks at the whole retention by default. */
export class ActivitySummaryQueryDto {
  /** How many days back to look, 1-90; default 90. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_DAYS_MAX)
  days: number = ACTIVITY_DAYS_MAX;
}

/** `user` is a username fragment or `anonymous`; `ip` a prefix; `path` a fragment. */
export class ActivityFilterDto extends ActivityDaysQueryDto {
  /** A username fragment, or `anonymous` for signed-out visitors. */
  @IsOptional() @IsString() @MaxLength(150) user?: string;
  /** IP address prefix. */
  @IsOptional() @IsString() @MaxLength(45) ip?: string;
  /** Fragment of the request path, case-insensitive. */
  @IsOptional() @IsString() @MaxLength(200) path?: string;
}

export class ActivityLogQueryDto extends ActivityFilterDto {
  /** Page number, 1-200. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  page: number = 1;
}
