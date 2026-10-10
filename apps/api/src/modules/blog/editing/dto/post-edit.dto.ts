import { OmitType, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { BLOG_TITLE_MAX_LENGTH } from '@libs/community';
import { MAX_MARKDOWN_LENGTH } from '../../../problems/core/dto/limits';
import { IsTimestamp } from '../../../problems/core/dto/timestamp';

/** Empty, an http(s) URL or a site path (legacy free text up to 150). */
const IMAGE_PATTERN = /^(|https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)$/;

/** Legacy `BlogPostForm` plus the admin-only summary and image; no property initializers (`PartialType` would inherit them). */
export class CreatePostDto {
  /** Post title, up to the blog title limit. */
  @IsString() @Length(1, BLOG_TITLE_MAX_LENGTH) title!: string;
  /** Markdown content, rendered when saved. */
  @IsString() @Length(1, MAX_MARKDOWN_LENGTH) content!: string;
  /** Markdown summary for lists; needs judge.edit_all_post. */
  @IsOptional() @IsString() @MaxLength(MAX_MARKDOWN_LENGTH) summary?: string;
  /** Defaults to now. */
  @IsOptional() @IsTimestamp() publishOn?: string;
  /** False keeps the post as a draft. */
  @IsOptional() @IsBoolean() visible?: boolean;
  /** `judge.mark_global_post`. */
  @IsOptional() @IsBoolean() globalPost?: boolean;
  /** `judge.pin_post`. */
  @IsOptional() @IsBoolean() sticky?: boolean;
  /**
   * Image for link previews: empty, an http or https URL, or a site path, at
   * most 150 characters; needs judge.edit_all_post.
   */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(IMAGE_PATTERN)
  ogImage?: string;
  /** Organization slug: a post for that organization by one of its admins with `judge.edit_organization_post`. */
  @IsOptional() @IsString() organization?: string;
}

export class UpdatePostDto extends PartialType(
  OmitType(CreatePostDto, ['organization'] as const),
) {
  /** Replaces the authors; `judge.edit_all_post`. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('7', { each: true })
  authorIds?: string[];
}
