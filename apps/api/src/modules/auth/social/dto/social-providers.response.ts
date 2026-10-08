import type { OAuthProvider } from '../oauth-provider';

export class SocialProvidersResponse {
  providers!: Array<OAuthProvider['slug']>;
}
