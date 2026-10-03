import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

/** Legacy DMOJ_PROBLEM_STATEMENT_DISALLOWED_CHARACTERS: typographic quotes, the minus sign and ligatures pasted from word processors. */
export const DISALLOWED_STATEMENT_CHARACTERS = [
  '“',
  '”',
  '‘',
  '’',
  '−',
  'ﬀ',
  'ﬁ',
  'ﬂ',
  'ﬃ',
  'ﬄ',
];

export function IsStatementText(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isStatementText',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          !DISALLOWED_STATEMENT_CHARACTERS.some((character) =>
            value.includes(character),
          ),
        defaultMessage: () =>
          `Disallowed characters: ${DISALLOWED_STATEMENT_CHARACTERS.join('')}`,
      },
    });
}
