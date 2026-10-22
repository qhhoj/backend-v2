import { LowercaseUuid } from '@libs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const MAX_PAGE = 10000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

export class SimilarityPairListDto {
  /** Only pairs on this problem id. */
  @IsOptional() @LowercaseUuid() @IsUUID() problemId?: string;
  /** Engine family (`cpp`, `python`, ...). */
  @IsOptional() @IsString() language?: string;
  /** 0 to 1. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;
  /** Page number, from 1. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;
  /** Items per page, 1 to 100. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;
}
