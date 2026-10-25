import { ApiProperty } from '@nestjs/swagger';

export class SocialLinksResponse {
  /** Slugs of the providers linked to the account (a legacy provider v2 does not support keeps its stored name). */
  @ApiProperty({ type: [String] })
  providers!: string[];
}
