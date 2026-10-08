import type { OAuthClientSetting as OAuthClient } from '@libs/settings';
import { fetchJson, requireText } from './fetch-json';
import { challengeOf } from './pkce';
import type { OAuthProvider, SocialIdentity } from './oauth-provider';

export class GoogleOAuthProvider implements OAuthProvider {
  readonly slug = 'google';
  readonly legacyName = 'google-oauth2';

  constructor(private readonly client: OAuthClient) {}

  authorizationUrl(
    state: string,
    codeVerifier: string,
    redirectUri: string,
  ): string {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: this.client.clientId,
      redirect_uri: redirectUri,
      scope: 'openid email',
      state,
      code_challenge: challengeOf(codeVerifier),
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }

  async fetchIdentity(
    code: string,
    codeVerifier: string,
    redirectUri: string,
  ): Promise<SocialIdentity> {
    const token = await fetchJson<{ access_token?: unknown }>(
      'Google token exchange',
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: this.client.clientId,
          client_secret: this.client.clientSecret,
          code_verifier: codeVerifier,
        }),
      },
    );
    const profile = await fetchJson<{
      sub?: unknown;
      email?: string;
      email_verified?: boolean;
    }>('Google userinfo', 'https://openidconnect.googleapis.com/v1/userinfo', {
      headers: {
        Authorization: `Bearer ${requireText('Google access token', token.access_token)}`,
      },
    });
    return {
      uid: requireText('Google uid', profile.sub),
      email: profile.email ?? null,
      emailVerified: profile.email_verified === true,
    };
  }
}
