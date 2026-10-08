import type { PipeTransform } from '@nestjs/common';
import { ValidationFailedError } from '../errors/validation-failed.error';

/** For PATCH bodies: `PartialType` makes every field `@IsOptional`, which also lets an explicit `null` through to the update. Refuses `null` on every field except `nullableFields`; runs after the global validation pipe. */
export class RefuseNullFieldsPipe implements PipeTransform<object, object> {
  constructor(private readonly nullableFields: readonly string[] = []) {}

  transform(body: object): object {
    const nulled = Object.entries(body)
      .filter(
        ([field, value]) =>
          value === null && !this.nullableFields.includes(field),
      )
      .map(([field]) => field);
    if (nulled.length)
      throw new ValidationFailedError(
        'Validation failed',
        nulled.map((field) => ({
          field,
          code: 'must_not_be_null',
          message: 'Must not be null.',
        })),
      );
    return body;
  }
}
