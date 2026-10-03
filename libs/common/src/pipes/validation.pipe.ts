import { ValidationPipe } from '@nestjs/common';
import type { ValidationError, ValidationPipeOptions } from '@nestjs/common';
import { AppError } from '../errors/app.error';

/** One entry per failing property; nested DTO errors get dotted keys (`languageLimits.0.timeLimit`). */
function flattenErrors(
  errors: ValidationError[],
  prefix = '',
): Array<[string, string[]]> {
  return errors.flatMap((error) => {
    const key = `${prefix}${error.property}`;
    const own: Array<[string, string[]]> = error.constraints
      ? [[key, Object.values(error.constraints)]]
      : [];
    return [...own, ...flattenErrors(error.children ?? [], `${key}.`)];
  });
}

export const createValidationPipe = (overrides: ValidationPipeOptions = {}) =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new AppError(
        'validation_failed',
        400,
        'Validation failed',
        Object.fromEntries(flattenErrors(errors)),
      ),
    ...overrides,
  });

export const validationPipe = createValidationPipe();
