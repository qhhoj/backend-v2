import type { PipeTransform } from '@nestjs/common';
import { AppError } from '../errors/app.error';

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
      throw new AppError(
        'validation_failed',
        400,
        'Validation failed',
        Object.fromEntries(
          nulled.map((field) => [field, ['Must not be null.']]),
        ),
      );
    return body;
  }
}
