import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { SITEMAP_KINDS } from '../sitemap.service';
import type { SitemapKind } from '../sitemap.service';

export class SitemapParamsDto {
  /** Which part of the site: `pages`, `problems`, `contests`, `posts` or `users`. */
  @IsIn(SITEMAP_KINDS) kind!: SitemapKind;
  /** Page number, starting at 1. */
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page!: number;
}

export class PreviewQueryDto {
  /** Site path of the page, e.g. `/problems/aplusb`. */
  @IsString() @MaxLength(300) path!: string;
}
