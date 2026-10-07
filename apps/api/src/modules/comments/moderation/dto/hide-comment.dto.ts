import { IsBoolean } from 'class-validator';

export class HideCommentDto {
  @IsBoolean() hidden!: boolean;
}
