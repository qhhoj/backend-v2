import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const USAGE_SORTS = ['name', 'credits'] as const;
export type UsageSort = (typeof USAGE_SORTS)[number];

export class UsageOverviewQueryDto {
  /** Order of the rows: by name or by credits used. */
  @ApiPropertyOptional({
    enum: USAGE_SORTS,
    enumName: 'OrganizationUsageSort',
  })
  @IsOptional()
  @IsIn(USAGE_SORTS)
  sort: UsageSort = 'name';
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Rows per page, 1 to 100. */
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
  /**
   * Credits per month, 0 to 1000000; null clears the cap so the site default
   * applies.
   */
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quotaMonthlyCredits?: number | null;
  /**
   * Problem data storage in bytes, 0 to 1099511627776; null clears the cap.
   */
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
