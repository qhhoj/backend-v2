export interface SocialIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export interface OAuthProvider {
  readonly slug: 'google' | 'facebook' | 'github';
  /** Provider name stored in `socialAuth.provider` (kept from the Django social-auth backends). */
  readonly legacyName: string;
  authorizationUrl(
    state: string,
    codeVerifier: string,
    redirectUri: string,
  ): string;
  /** Throws on any provider failure or an identity without a uid. */
  fetchIdentity(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<SocialIdentity>;
}

/** Only the configured providers. */
export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
