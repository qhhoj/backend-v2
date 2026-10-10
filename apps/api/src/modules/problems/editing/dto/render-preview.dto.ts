import { RENDER_STYLES } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from '../../core/dto/limits';

export class RenderPreviewDto {
  /** Render style: `problem`, `problem-full` (unsanitized, needs `judge.problem_full_markup`), `solution`, `blog` or `user`. */
  @IsIn(RENDER_STYLES) style!: RenderStyle;
  /** Markdown to render. */
  @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) markdown!: string;
}
