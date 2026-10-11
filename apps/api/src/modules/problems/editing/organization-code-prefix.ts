import type { Principal } from '@libs/auth';
import { ValidationFailedError } from '@libs/common';

/** Issue code of a 400 on `code` whose organization prefix is missing; the SPA words it from the code. */
export const ORGANIZATION_CODE_PREFIX_ISSUE = 'organization_code_prefix';

/** An organization problem's code is the prefix plus at least one more character; superusers may choose any code. */
export function assertOrganizationCodePrefix(
  principal: Pick<Principal, 'isSuperuser'>,
  code: string,
  prefix: string,
): void {
  if (principal.isSuperuser) return;
  if (code.startsWith(prefix) && code.length > prefix.length) return;
  throw new ValidationFailedError('Organization problem code prefix', [
    {
      field: 'code',
      code: ORGANIZATION_CODE_PREFIX_ISSUE,
      message: `An organization problem code must start with "${prefix}" and continue after it, for example ${prefix}bai1.`,
    },
  ]);
}
