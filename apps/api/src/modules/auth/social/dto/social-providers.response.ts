import { ApiProperty } from '@nestjs/swagger';
import type { OAuthProvider } from '../oauth-provider';

export class SocialProvidersResponse {
  /** Slugs of the enabled providers. */
  @ApiProperty({ type: [String] })
  providers!: Array<OAuthProvider['slug']>;
}
