import { ApiProperty } from '@nestjs/swagger';
import { PUBLISH_OUTCOMES, PUBLISH_SKIP_REASONS } from '@libs/problems';
import type { PublishOutcome, PublishSkipReason } from '@libs/problems';

export const EDITORIAL_OUTCOMES = [
  'published',
  'unchanged',
  'none',
  'skipped',
] as const;
export type EditorialOutcome = (typeof EDITORIAL_OUTCOMES)[number];

/** The three enum properties are union aliases: the plugin drops them without the explicit decorators (R3). */
export class PublishedProblemResponse {
  problemId!: string;
  /** Null when the problem document is gone. */
  code!: string | null;
  /** In a dry run, `published` means "would be published". */
  @ApiProperty({ enum: PUBLISH_OUTCOMES, enumName: 'PublishOutcome' })
  outcome!: PublishOutcome;
  @ApiProperty({
    enum: PUBLISH_SKIP_REASONS,
    enumName: 'PublishSkipReason',
    nullable: true,
  })
  reason!: PublishSkipReason | null;
  /** Null when editorials were not requested. */
  @ApiProperty({
    enum: EDITORIAL_OUTCOMES,
    enumName: 'EditorialOutcome',
    nullable: true,
  })
  editorial!: EditorialOutcome | null;
}

export class PublishProblemsResponse {
  dryRun!: boolean;
  items!: PublishedProblemResponse[];
}
