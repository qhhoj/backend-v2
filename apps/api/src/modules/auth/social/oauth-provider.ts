export interface SocialIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

export type SocialProviderSlug = 'google' | 'facebook' | 'github';

/** Name stored in `socialAuth.provider` for each supported provider, enabled or not (kept from the Django social-auth backends). */
export const SOCIAL_PROVIDER_NAMES = {
  google: 'google-oauth2',
  facebook: 'facebook',
  github: 'github-secure',
} as const satisfies Record<SocialProviderSlug, string>;

const NAME_BY_SLUG = new Map<string, string>(
  Object.entries(SOCIAL_PROVIDER_NAMES),
);
const SLUG_BY_NAME = new Map<string, string>(
  Object.entries(SOCIAL_PROVIDER_NAMES).map(([slug, name]) => [name, slug]),
);

/** The stored name for a slug; any other value is taken as a stored name already (a legacy provider v2 does not support). */
export const socialProviderName = (slug: string): string =>
  NAME_BY_SLUG.get(slug) ?? slug;

/** The slugs of a user's links in stored order; a legacy provider v2 does not support keeps its stored name. */
export const linkedProviders = (links: readonly { provider: string }[]) =>
  links.map(({ provider }) => SLUG_BY_NAME.get(provider) ?? provider);

export interface OAuthProvider {
  readonly slug: SocialProviderSlug;
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
