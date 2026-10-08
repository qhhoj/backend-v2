import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { trim } from '../../../problems/core/dto/transforms';
import { MEMBER_SORTS } from '../organization-members.repository';
import type { MemberSort } from '../organization-members.repository';

/** Unvalidated shape: a malformed slug is a 404 (no organization matches), never a 400. */
export class OrganizationSlugParamDto {
  @IsString() slug!: string;
}

export class OrganizationListQueryDto {
  /** Substring over name, shortName and slug; surrounding spaces are dropped. 50 bounds a name; the user search allows 64. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 50)
  search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 100;
}

export class MemberListQueryDto {
  @IsOptional() @IsIn(MEMBER_SORTS) sort: MemberSort = 'performancePoints';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 100;
}
