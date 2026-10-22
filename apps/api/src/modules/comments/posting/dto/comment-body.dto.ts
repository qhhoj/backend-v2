import { LowercaseUuid } from '@libs/common';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { COMMENT_MAX_LENGTH } from '@libs/community';

export class CommentBodyDto {
  /** Markdown text of the comment; must not be blank. */
  @IsString()
  @Length(1, COMMENT_MAX_LENGTH)
  @Matches(/\S/, { message: 'body must not be blank' })
  body!: string;
}

export class NewCommentDto extends CommentBodyDto {
  /** A visible comment of the same page. */
  @IsOptional() @LowercaseUuid() @IsUUID('7') parentId?: string;
}
