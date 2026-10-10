import { ApiProperty } from '@nestjs/swagger';
import { TAG_COLORS, uuidStr } from '@libs/database';
import type { OrganizationProblemTag, TagColor } from '@libs/database';

export class ProblemTagResponse {
  /** Id of the tag. */
  id!: string;
  /** The tag's identifier within the organization. */
  slug!: string;
  /** Display name. */
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
