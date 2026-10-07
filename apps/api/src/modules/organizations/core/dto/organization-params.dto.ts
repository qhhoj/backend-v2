import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MEMBER_SORTS } from '../organization-members.repository';
import type { MemberSort } from '../organization-members.repository';

/** Unvalidated shape: a malformed slug is a 404 (no organization matches), never a 400. */
export class OrganizationSlugParamDto {
  @IsString() slug!: string;
}

export class OrganizationListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 100;
}

export class MemberListQueryDto {
  @IsOptional() @IsIn(MEMBER_SORTS) sort: MemberSort = 'performancePoints';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 100;
}
