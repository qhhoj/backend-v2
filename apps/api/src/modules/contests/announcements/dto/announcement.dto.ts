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
  /** Announcement title. */
  @IsString() @Length(1, ANNOUNCEMENT_TITLE_MAX) title!: string;
  /** Announcement body in Markdown; it is rendered to HTML when saved. */
  @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) description!: string;
}

export class AnnouncementListQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
  /** Announcements per page, 1 to 50. */
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
