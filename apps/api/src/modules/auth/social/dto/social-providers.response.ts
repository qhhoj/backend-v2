import { ApiProperty } from '@nestjs/swagger';
import type { OAuthProvider } from '../oauth-provider';

export class SocialProvidersResponse {
  @ApiProperty({ type: [String] })
  providers!: Array<OAuthProvider['slug']>;
}
