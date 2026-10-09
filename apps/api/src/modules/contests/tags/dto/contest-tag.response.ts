import { ApiProperty } from '@nestjs/swagger';
import { CONTEST_TAG_COLORS } from '@libs/database';
import type { ContestTag, ContestTagColor } from '@libs/database';

export class ContestTagResponse {
  slug!: string;
  name!: string;

  /** A theme token key (`tag-1`..`tag-8`), never a hex. */
  @ApiProperty({ enum: CONTEST_TAG_COLORS, enumName: 'ContestTagColor' })
  color!: ContestTagColor;

  description!: string;
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
