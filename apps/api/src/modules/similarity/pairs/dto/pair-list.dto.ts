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
  @IsOptional() @IsUUID() problemId?: string;
  /** Engine family (`cpp`, `python`, ...). */
  @IsOptional() @IsString() language?: string;
  /** 0 to 1. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minSimilarity?: number;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page = 1;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize = DEFAULT_PAGE_SIZE;
}
