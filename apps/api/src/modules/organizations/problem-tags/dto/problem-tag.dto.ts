import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { TAG_COLORS, ORGANIZATION_TAG_SLUG_PATTERN } from '@libs/database';
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
  Min,
} from 'class-validator';

export class CreateProblemTagDto {
  /**
   * Lowercase letters, digits and hyphens, 1 to 20 characters; never changes.
   */
  @Matches(ORGANIZATION_TAG_SLUG_PATTERN, {
    message: 'Lowercase letters, digits and hyphens (1-20).',
  })
  slug!: string;
  /** Display name, 1 to 40 characters. */
  @IsString() @Length(1, 40) name!: string;
  /** The palette token keys, shared with the contest tags (`TagColor`). */
  @ApiPropertyOptional({
    enum: TAG_COLORS,
    enumName: 'TagColor',
  })
  @IsOptional()
  @IsIn(TAG_COLORS)
  color?: TagColor;
}

/** The slug is the tag's identity in URLs and filters: it never changes. */
export class UpdateProblemTagDto extends PartialType(
  OmitType(CreateProblemTagDto, ['slug'] as const),
) {}

/** Unvalidated shape: an unknown slug is a 404, never a 400. */
export class ProblemTagParamsDto {
  /** Slug of the organization. */
  @IsString() slug!: string;
  /** Slug of the problem tag. */
  @IsString() tagSlug!: string;
}

export class ProblemTagListQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Tags per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 100;
}
