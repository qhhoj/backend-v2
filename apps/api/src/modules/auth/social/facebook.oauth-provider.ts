import type { OAuthClient } from '@libs/common';
import { fetchJson, requireText } from './fetch-json';
import type { OAuthProvider, SocialIdentity } from './oauth-provider';

export class FacebookOAuthProvider implements OAuthProvider {
  readonly slug = 'facebook';
  readonly legacyName = 'facebook';

  constructor(private readonly client: OAuthClient) {}

  authorizationUrl(
    state: string,
    _codeVerifier: string,
    redirectUri: string,
  ): string {
    const query = new URLSearchParams({
      client_id: this.client.clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'email',
    });
    return `https://www.facebook.com/v19.0/dialog/oauth?${query}`;
  }

  async fetchIdentity(
    code: string,
    _codeVerifier: string,
    redirectUri: string,
  ): Promise<SocialIdentity> {
    const tokenQuery = new URLSearchParams({
      client_id: this.client.clientId,
      redirect_uri: redirectUri,
      client_secret: this.client.clientSecret,
      code,
    });
    const token = await fetchJson<{ access_token?: unknown }>(
      'Facebook token exchange',
      `https://graph.facebook.com/v19.0/oauth/access_token?${tokenQuery}`,
    );
    const profileQuery = new URLSearchParams({
      fields: 'id,email',
      access_token: requireText('Facebook access token', token.access_token),
    });
    const profile = await fetchJson<{ id?: unknown; email?: string }>(
      'Facebook profile',
      `https://graph.facebook.com/me?${profileQuery}`,
    );
    const email = profile.email || null;
    // Facebook only returns an email it has confirmed.
    return {
      uid: requireText('Facebook uid', profile.id),
      email,
      emailVerified: Boolean(email),
    };
  }
}
