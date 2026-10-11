import { applyDecorators } from '@nestjs/common';
import { Matches, MaxLength } from 'class-validator';
import type { FieldIssue } from '@libs/common';

/** Legacy `User.username` rules (registration, staff create and rename): letters, digits and underscores, up to 30 characters. */
export const IsUsername = () =>
  applyDecorators(
    Matches(/^\w+$/, {
      message: 'A username must contain letters, numbers, or underscores.',
      context: { code: 'username_invalid_characters' },
    }),
    MaxLength(30),
  );

export const USERNAME_TAKEN: FieldIssue = {
  field: 'username',
  code: 'username_taken',
  message: 'Username is taken.',
};
