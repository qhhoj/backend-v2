import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { TAG_COLORS, CONTEST_TAG_PATTERN } from '@libs/database';
import type { TagColor } from '@libs/database';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** The catalogue is small by design; one page of this size always holds all of it. */
export const MAX_CONTEST_TAGS = 100;

export class ContestTagListQueryDto {
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
  @Max(MAX_CONTEST_TAGS)
  pageSize: number = MAX_CONTEST_TAGS;
}

export class CreateContestTagDto {
  @Matches(CONTEST_TAG_PATTERN, {
    message: 'Only lowercase letters, digits and hyphens (1-20).',
  })
  slug!: string;

  @IsString()
  @Length(1, 40)
  name!: string;

  /** A union alias: the plugin drops it without the explicit decorator (R3). */
  @ApiProperty({ enum: TAG_COLORS, enumName: 'TagColor' })
  @IsIn(TAG_COLORS)
  color!: TagColor;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(-1000)
  @Max(1000)
  order?: number;
}

export class UpdateContestTagDto extends PartialType(
  OmitType(CreateContestTagDto, ['slug'] as const),
) {}

/** Unvalidated shape: an unknown or malformed slug is a 404, never a 400. */
export class ContestTagSlugParamDto {
  @IsString()
  slug!: string;
}
