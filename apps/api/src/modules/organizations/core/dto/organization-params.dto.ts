import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { toBoolean, trim } from '../../../problems/core/dto/transforms';
import { MEMBER_SORTS } from '../organization-members.repository';
import type { MemberSort } from '../organization-members.repository';

/** Unvalidated shape: a malformed slug is a 404 (no organization matches), never a 400. */
export class OrganizationSlugParamDto {
  /** Slug of the organization. */
  @IsString() slug!: string;
}

export class OrganizationListQueryDto {
  /** Substring over name, shortName and slug; surrounding spaces are dropped. 50 bounds a name; the user search allows 64. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  search?: string;
  /** true: only open organizations; false: only private ones. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() open?: boolean;
  /** true: only unlisted organizations; false: only listed ones. Narrows what the viewer may already list. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() unlisted?: boolean;
  /** true: only organizations the viewer may administer (their admin, or every one with `judge.edit_all_organization`); false: only the others. */
  @IsOptional() @Transform(toBoolean) @IsBoolean() administered?: boolean;
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Organizations per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 100;
}

export class MemberListQueryDto {
  /** Keeps members whose username contains this text (any case); ranks then count matching members only. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 64)
  search?: string;
  /** Ranking column, best first. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(MEMBER_SORTS)
  sort: MemberSort = 'performancePoints';
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Members per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 100;
}
