import { IsString, MaxLength } from 'class-validator';
import { MAX_MARKDOWN_LENGTH } from '../../../problems/core/dto/limits';

export class FlatpagePreviewDto {
  /** Markdown to render. */
  @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) content!: string;
}
