import type { AuthContext } from '../guards/auth-context';
import type { Principal } from './principal';

/** Principal of a request on a `@Public()` route: null when anonymous, or when the session has not passed the 2FA / pwned-password gates the guard skips for public routes. */
export const optionalPrincipal = (
  auth: AuthContext | undefined,
): Principal | null =>
  !auth ||
  (auth.session !== null &&
    (!auth.session.twoFaPassed || auth.session.passwordPwned))
    ? null
    : auth.principal;
