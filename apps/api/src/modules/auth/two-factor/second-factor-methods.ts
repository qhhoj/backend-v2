import type { UserDocument } from '@libs/auth';

export const SECOND_FACTOR_METHODS = ['totp', 'webauthn'] as const;
export type SecondFactorMethod = (typeof SECOND_FACTOR_METHODS)[number];

/** TOTP is enrolled only with a stored key: the flag alone (a migrated row) cannot be passed, so it counts as not enrolled and can be enrolled again. */
export const isTotpEnrolled = (
  user: Pick<UserDocument, 'isTotpEnabled' | 'totpKey'>,
): boolean => user.isTotpEnabled && !!user.totpKey;

/**
 * The second factors a user can actually pass, derived from stored credentials, not the legacy flags:
 * a migrated user with a legacy flag set but no key would otherwise be locked out for good.
 */
export function secondFactorMethods(
  user: Pick<
    UserDocument,
    'isTotpEnabled' | 'totpKey' | 'isWebauthnEnabled' | 'webauthnCredentials'
  >,
): SecondFactorMethod[] {
  const methods: SecondFactorMethod[] = [];
  if (isTotpEnrolled(user)) methods.push('totp');
  if (user.isWebauthnEnabled && user.webauthnCredentials?.length)
    methods.push('webauthn');
  return methods;
}
