import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import {
  TICKET_CANNED_REPLY_BODY_MAX,
  TICKET_CANNED_REPLY_TITLE_MAX,
} from '@libs/database';
import { trim } from '../../../problems/core/dto/transforms';

export class CreateCannedReplyDto {
  /** Short name of the template. */
  @Transform(trim)
  @IsString()
  @Length(1, TICKET_CANNED_REPLY_TITLE_MAX)
  title!: string;
  /** May hold `{tên}` and `{bài}`; the SPA fills them in. */
  @Transform(trim)
  @IsString()
  @Length(1, TICKET_CANNED_REPLY_BODY_MAX)
  body!: string;
  /** Default: after the last one. */
  @IsOptional() @IsInt() @Min(0) @Max(10000) order?: number;
}

/** Every field is optional; `RefuseNullFieldsPipe` turns an explicit `null` into `must_not_be_null`. */
export class UpdateCannedReplyDto {
  /** Short name of the template. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, TICKET_CANNED_REPLY_TITLE_MAX)
  title?: string;
  /** Template text. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, TICKET_CANNED_REPLY_BODY_MAX)
  body?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10000) order?: number;
}

export class CannedReplyPageQueryDto {
  /** 1-based page number. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

/** Unvalidated: a malformed id is a 404. */
export class CannedReplyIdParamDto {
  /** Id of the canned reply. */
  @IsString() id!: string;
}
