import { fakeSettings } from '@libs/settings/testing';
import { OAuthProvidersService } from './oauth-providers.service';

const client = { enabled: true, clientId: 'id', clientSecret: 'secret' };

describe('OAuthProvidersService', () => {
  it('lists only enabled providers, in a stable order', () => {
    const providers = new OAuthProvidersService(
      fakeSettings({ 'auth.github': client, 'auth.google': client }),
    );
    expect(providers.slugs()).toEqual(['google', 'github']);
    expect(providers.find('facebook')).toBeUndefined();
    expect(providers.find('github')?.slug).toBe('github');
  });

  it('follows a change at once: a disabled provider disappears, a new one appears', () => {
    const settings = fakeSettings({ 'auth.google': client });
    const providers = new OAuthProvidersService(settings);
    const before = providers.find('google');
    settings.override('auth.google', { ...client, enabled: false });
    settings.override('auth.facebook', client);
    expect(providers.slugs()).toEqual(['facebook']);
    expect(providers.find('google')).toBeUndefined();
    settings.override('auth.google', { ...client, clientId: 'rotated' });
    const after = providers.find('google')!;
    expect(
      after.authorizationUrl('state', 'verifier', 'http://redirect'),
    ).toContain('client_id=rotated');
    expect(before).not.toBe(after);
  });
});
