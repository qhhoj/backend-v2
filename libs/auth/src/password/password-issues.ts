import type { FieldIssue } from '@libs/common';
import { passwordProblems, PWNED_PASSWORD_PROBLEM } from './password-policy';
import type { PwnedPasswordService } from './pwned-password.service';

/** The signup policy plus the breach check, as issues on `field`; empty when the password is acceptable. */
export async function passwordIssues(
  pwned: PwnedPasswordService,
  password: string,
  owner: { username: string; email: string },
  field: string,
): Promise<FieldIssue[]> {
  const problems = passwordProblems(password, owner);
  if (await pwned.isPwned(password)) problems.push(PWNED_PASSWORD_PROBLEM);
  return problems.map((problem) => ({ field, ...problem }));
}
