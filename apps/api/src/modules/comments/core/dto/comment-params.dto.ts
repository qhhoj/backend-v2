import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { COMMENT_PAGE_TYPES } from '@libs/community';
import type { CommentPageType } from '@libs/community';

/** An unknown type is a 400; an unknown or malformed key a 404. */
export class CommentPageParamsDto {
  /** Kind of page the comments belong to. */
  @ApiProperty({ enum: COMMENT_PAGE_TYPES, enumName: 'CommentPageType' })
  @IsIn(COMMENT_PAGE_TYPES)
  type!: CommentPageType;

  /**
   * Natural key of the page: problem code, contest key, post id or tag problem
   * code.
   */
  @IsString() key!: string;
}

export class CommentPageQueryDto {
  /** 1-based page number of threads. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page: number = 1;
}

/** Unvalidated: a malformed id is a 404. */
export class CommentIdParamDto {
  /** Id of the comment. */
  @IsString() id!: string;
}
