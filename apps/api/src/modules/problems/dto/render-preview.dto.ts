import { RENDER_STYLES } from '@libs/render';
import type { RenderStyle } from '@libs/render';
import { IsIn, IsString, MaxLength } from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from './problem-edit.dto';

export class RenderPreviewDto {
  @IsIn(RENDER_STYLES) style!: RenderStyle;
  @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) markdown!: string;
}
