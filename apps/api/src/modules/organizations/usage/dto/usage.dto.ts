import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const USAGE_SORTS = ['name', 'credits'] as const;
export type UsageSort = (typeof USAGE_SORTS)[number];

export class UsageOverviewQueryDto {
  @ApiPropertyOptional({
    enum: USAGE_SORTS,
    enumName: 'OrganizationUsageSort',
  })
  @IsOptional()
  @IsIn(USAGE_SORTS)
  sort: UsageSort = 'name';
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

/** `null` clears a cap: the site default applies again. */
export class UpdateQuotaDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quotaMonthlyCredits?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_099_511_627_776)
  quotaStorageBytes?: number | null;
  /** The unlimited promotion: true applies no limit, false ends it. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  quotaUnlimited?: boolean;
}
