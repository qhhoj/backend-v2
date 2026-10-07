import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { COMMENT_PAGE_TYPES } from '@libs/community';
import type { CommentPageType } from '@libs/community';

/** An unknown type is a 400; an unknown or malformed key a 404. */
export class CommentPageParamsDto {
  @IsIn(COMMENT_PAGE_TYPES) type!: CommentPageType;
  @IsString() key!: string;
}

export class CommentPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
}

/** Unvalidated: a malformed id is a 404. */
export class CommentIdParamDto {
  @IsString() id!: string;
}
