import { ORGANIZATION_TAG_SLUG_PATTERN } from '@libs/database';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose, Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { trim } from '../../../problems/core/dto/transforms';

export const ARCHIVE_FILTERS = ['false', 'true', 'all'] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

export class OrganizationProblemListQueryDto {
  /** Only problems with this tag slug. */
  @IsOptional() @Matches(ORGANIZATION_TAG_SLUG_PATTERN) tag?: string;
  /** Default: archived problems are hidden. */
  @ApiPropertyOptional({
    enum: ARCHIVE_FILTERS,
    enumName: 'OrganizationProblemArchiveFilter',
  })
  @IsOptional()
  @IsIn(ARCHIVE_FILTERS)
  archived: ArchiveFilter = 'false';
  /** The `q` query parameter (a longer property name keeps the `id-length` lint rule); `name: 'q'` documents the wire name. */
  @ApiPropertyOptional({ name: 'q' })
  @Expose({ name: 'q' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  search?: string;
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Problems per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 50;
}

export class SetProblemTagsDto {
  /**
   * Ids of the tags the problem should have, at most 20; replaces its current
   * tags.
   */
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  tagIds!: string[];
}

/** Unvalidated shape: an unknown slug or code is a 404. */
export class OrganizationProblemParamsDto {
  /** Slug of the organization. */
  @IsString() slug!: string;
  /** Code of the problem. */
  @IsString() code!: string;
}
