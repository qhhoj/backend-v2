import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { COMMENT_MAX_LENGTH } from '@libs/community';

export class CommentBodyDto {
  @IsString() @Length(1, COMMENT_MAX_LENGTH) body!: string;
}

export class NewCommentDto extends CommentBodyDto {
  /** A visible comment of the same page. */
  @IsOptional() @IsUUID('7') parentId?: string;
}
