import { ApiProperty } from '@nestjs/swagger';
import { TAG_COLORS } from '@libs/database';
import type { ContestTag, TagColor } from '@libs/database';

export class ContestTagResponse {
  /** The tag's identifier. */
  slug!: string;
  /** Display name. */
  name!: string;

  /** A theme token key (`tag-1`..`tag-8`), never a hex. */
  @ApiProperty({ enum: TAG_COLORS, enumName: 'TagColor' })
  color!: TagColor;

  /** Short description. */
  description!: string;
  /** Sort position; lower comes first. */
  order!: number;

  static from(
    tag: Pick<ContestTag, 'slug' | 'name' | 'color' | 'description' | 'order'>,
  ): ContestTagResponse {
    return {
      slug: tag.slug,
      name: tag.name,
      color: tag.color,
      description: tag.description,
      order: tag.order,
    };
  }
}
