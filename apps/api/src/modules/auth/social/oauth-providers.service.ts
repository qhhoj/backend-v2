import { Inject, Injectable } from '@nestjs/common';
import { SettingsService } from '@libs/settings';
import { FacebookOAuthProvider } from './facebook.oauth-provider';
import { GithubOAuthProvider } from './github.oauth-provider';
import { GoogleOAuthProvider } from './google.oauth-provider';
import type { OAuthProvider } from './oauth-provider';

/** The providers an admin enabled, rebuilt from the settings on every call: the objects are cheap, and a change (enable, disable, rotated secret) applies at once. */
@Injectable()
export class OAuthProvidersService {
  constructor(
    @Inject(SettingsService)
    private readonly settings: Pick<SettingsService, 'get'>,
  ) {}

  find(slug: string): OAuthProvider | undefined {
    return this.enabled().find((provider) => provider.slug === slug);
  }

  slugs(): Array<OAuthProvider['slug']> {
    return this.enabled().map((provider) => provider.slug);
  }

  private enabled(): OAuthProvider[] {
    const google = this.settings.get('auth.google');
    const facebook = this.settings.get('auth.facebook');
    const github = this.settings.get('auth.github');
    const candidates: Array<OAuthProvider | false> = [
      google.enabled && new GoogleOAuthProvider(google),
      facebook.enabled && new FacebookOAuthProvider(facebook),
      github.enabled && new GithubOAuthProvider(github),
    ];
    return candidates.filter((provider) => provider !== false);
  }
}
