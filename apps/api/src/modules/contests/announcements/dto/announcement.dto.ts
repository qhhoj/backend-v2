import { ApiPropertyOptional } from '@nestjs/swagger';
import { ANNOUNCEMENT_TITLE_MAX } from '@libs/database';
import { MAX_MARKDOWN_LENGTH } from '../../../problems/core/dto/limits';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateAnnouncementDto {
  @IsString() @Length(1, ANNOUNCEMENT_TITLE_MAX) title!: string;
  @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) description!: string;
}

export class AnnouncementListQueryDto {
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
  @Max(50)
  pageSize: number = 20;
}

/** The key stays unvalidated like `ContestKeyParamDto`; a malformed id is a 400. */
export class AnnouncementIdParamDto {
  @IsString() key!: string;
  @IsUUID('7') id!: string;
}
