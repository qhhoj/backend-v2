import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import {
  DISALLOWED_STATEMENT_CHARACTERS,
  findDisallowedCharacter,
} from '@libs/problems';

export function IsStatementText(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isStatementText',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && findDisallowedCharacter(value) === null,
        defaultMessage: () =>
          `Disallowed characters: ${DISALLOWED_STATEMENT_CHARACTERS.join('')}`,
      },
    });
}
