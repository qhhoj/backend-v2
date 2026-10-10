import type { UserDocument } from '@libs/auth';

export const SECOND_FACTOR_METHODS = ['totp', 'webauthn'] as const;
export type SecondFactorMethod = (typeof SECOND_FACTOR_METHODS)[number];

/**
 * The second factors a user can actually pass, derived from stored credentials, not the legacy flags:
 * a migrated user with the legacy WebAuthn flag set but no key would otherwise be locked out for good.
 */
export function secondFactorMethods(
  user: Pick<
    UserDocument,
    'isTotpEnabled' | 'isWebauthnEnabled' | 'webauthnCredentials'
  >,
): SecondFactorMethod[] {
  const methods: SecondFactorMethod[] = [];
  if (user.isTotpEnabled) methods.push('totp');
  if (user.isWebauthnEnabled && user.webauthnCredentials?.length)
    methods.push('webauthn');
  return methods;
}
