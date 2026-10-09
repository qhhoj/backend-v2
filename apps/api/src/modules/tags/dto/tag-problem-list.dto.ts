import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toArray } from '@libs/common';
import { TAG_JUDGES } from '../tag-links';

export class TagProblemListQueryDto {
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
  /** Case-insensitive substring of the code or name (legacy `icontains`). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[^\0]*$/)
  search?: string;
  /** A tag code. */
  @IsOptional() @IsString() @MaxLength(30) tag?: string;
  @IsOptional()
  @Transform(toArray)
  @IsIn(TAG_JUDGES, { each: true })
  judges?: string[];
}
