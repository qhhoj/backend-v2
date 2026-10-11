import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsTimestamp } from '../../problems/core/dto/timestamp';
import { AUDIT_PAGE_SIZE, AUDIT_TYPES } from '../audit-types';
import type { AuditType } from '../audit-types';

export class AuditQueryDto {
  /** Only changes made by this user (exact username, case-insensitive). An unknown username gives an empty feed. */
  @IsOptional() @IsString() @MaxLength(150) actor?: string;

  /** Only changes to this kind of object. */
  @ApiPropertyOptional({ enum: AUDIT_TYPES })
  @IsOptional()
  @IsIn(AUDIT_TYPES)
  type?: AuditType;

  /** Changes at or after this time (ISO 8601 with offset). */
  @IsOptional() @IsTimestamp() from?: string;

  /** Changes before this time (ISO 8601 with offset). */
  @IsOptional() @IsTimestamp() to?: string;

  /** The `nextBefore` of the previous page: only changes older than that entry. */
  @IsOptional() @IsUUID() before?: string;

  /** Page size, 1-50; default 50. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AUDIT_PAGE_SIZE)
  limit: number = AUDIT_PAGE_SIZE;
}
