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
  @Max(100)
  pageSize: number = 50;
}

export class SetProblemTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('7', { each: true })
  tagIds!: string[];
}

/** Unvalidated shape: an unknown slug or code is a 404. */
export class OrganizationProblemParamsDto {
  @IsString() slug!: string;
  @IsString() code!: string;
}
