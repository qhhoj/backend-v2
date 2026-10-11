import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ABOUT_MAX_LENGTH } from '@libs/community';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class OrganizationAboutPreviewDto {
  /** Markdown about text to render. */
  @IsString() @MaxLength(ABOUT_MAX_LENGTH) markdown!: string;
}

export class OrganizationHistoryQueryDto {
  /** 1-based page number; 20 revisions per page. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}
