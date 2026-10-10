import { IsBoolean } from 'class-validator';

export class HideCommentDto {
  /** True to hide the comment and its replies, false to restore them. */
  @IsBoolean() hidden!: boolean;
}
