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
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) page = 1;
}

export class ActivityDaysQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_DAYS_MAX)
  days = ACTIVITY_DAYS_DEFAULT;
}

/** The summary looks at the whole retention by default. */
export class ActivitySummaryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_DAYS_MAX)
  days = ACTIVITY_DAYS_MAX;
}

/** `user` is a username fragment or `anonymous`; `ip` a prefix; `path` a fragment. */
export class ActivityFilterDto extends ActivityDaysQueryDto {
  @IsOptional() @IsString() @MaxLength(150) user?: string;
  @IsOptional() @IsString() @MaxLength(45) ip?: string;
  @IsOptional() @IsString() @MaxLength(200) path?: string;
}

export class ActivityLogQueryDto extends ActivityFilterDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) page = 1;
}
