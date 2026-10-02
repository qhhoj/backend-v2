import type { OAuthClient } from '@libs/common';
import { fetchJson, requireText } from './fetch-json';
import type { OAuthProvider, SocialIdentity } from './oauth-provider';

const API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'qhhoj',
};

export class GithubOAuthProvider implements OAuthProvider {
  readonly slug = 'github';
  readonly legacyName = 'github-secure';

  constructor(private readonly client: OAuthClient) {}

  authorizationUrl(
    state: string,
    _codeVerifier: string,
    redirectUri: string,
  ): string {
    const query = new URLSearchParams({
      client_id: this.client.clientId,
      redirect_uri: redirectUri,
      scope: 'user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${query}`;
  }

  async fetchIdentity(
    code: string,
    _codeVerifier: string,
    redirectUri: string,
  ): Promise<SocialIdentity> {
    // GitHub answers a rejected code with HTTP 200 and no access_token.
    const token = await fetchJson<{ access_token?: unknown }>(
      'GitHub token exchange',
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams({
          client_id: this.client.clientId,
          client_secret: this.client.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      },
    );
    const headers = {
      ...API_HEADERS,
      Authorization: `Bearer ${requireText('GitHub access token', token.access_token)}`,
    };
    const profile = await fetchJson<{ id?: unknown }>(
      'GitHub profile',
      'https://api.github.com/user',
      { headers },
    );
    const emails = await fetchJson<
      Array<{ email: string; primary: boolean; verified: boolean }>
    >('GitHub emails', 'https://api.github.com/user/emails', { headers });
    const primary = emails.find(({ primary, verified }) => primary && verified);
    return {
      uid: requireText('GitHub uid', profile.id),
      email: primary?.email ?? null,
      emailVerified: Boolean(primary),
    };
  }
}
