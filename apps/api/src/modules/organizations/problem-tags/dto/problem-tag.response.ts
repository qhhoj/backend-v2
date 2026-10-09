import { ApiProperty } from '@nestjs/swagger';
import { ORGANIZATION_TAG_COLORS, uuidStr } from '@libs/database';
import type {
  OrganizationProblemTag,
  OrganizationTagColor,
} from '@libs/database';

export class ProblemTagResponse {
  id!: string;
  slug!: string;
  name!: string;
  /** A colour token key (`tag-1`..`tag-8`), never a hex. */
  @ApiProperty({
    enum: ORGANIZATION_TAG_COLORS,
    enumName: 'OrganizationTagColor',
  })
  color!: OrganizationTagColor;

  static from(tag: OrganizationProblemTag): ProblemTagResponse {
    return {
      id: uuidStr(tag._id),
      slug: tag.slug,
      name: tag.name,
      color: tag.color,
    };
  }
}
