import { applyDecorators } from '@nestjs/common';
import { Matches, MaxLength } from 'class-validator';
import { MAIL_ADDRESS_PATTERN } from '@libs/common';
import type { FieldIssue } from '@libs/common';

/** A deliverable-looking address up to 254 characters; the issue code is `email_invalid`. */
export const IsMailAddress = () =>
  applyDecorators(
    Matches(MAIL_ADDRESS_PATTERN, {
      message: 'Enter a valid email address.',
      context: { code: 'email_invalid' },
    }),
    MaxLength(254),
  );

export const EMAIL_TAKEN: FieldIssue = {
  field: 'email',
  code: 'email_taken',
  message: 'Email is already registered.',
};

/** Staff-entered addresses: trimmed by the DTO, domain lower-cased here (the local part may be case-sensitive). */
export const normaliseEmail = (email: string): string => {
  const at = email.lastIndexOf('@');
  return email.slice(0, at + 1) + email.slice(at + 1).toLowerCase();
};
