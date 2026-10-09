import { ApiProperty } from '@nestjs/swagger';
import { TAG_COLORS, uuidStr } from '@libs/database';
import type { OrganizationProblemTag, TagColor } from '@libs/database';

export class ProblemTagResponse {
  id!: string;
  slug!: string;
  name!: string;
  /** A colour token key (`tag-1`..`tag-8`), never a hex. */
  @ApiProperty({
    enum: TAG_COLORS,
    enumName: 'TagColor',
  })
  color!: TagColor;

  static from(tag: OrganizationProblemTag): ProblemTagResponse {
    return {
      id: uuidStr(tag._id),
      slug: tag.slug,
      name: tag.name,
      color: tag.color,
    };
  }
}
