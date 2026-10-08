import { ValidationPipe } from '@nestjs/common';
import type { ValidationError, ValidationPipeOptions } from '@nestjs/common';
import type { FieldIssue } from '../errors/app.error';
import { ValidationFailedError } from '../errors/validation-failed.error';

const snakeCase = (name: string) =>
  name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

/** One issue per failing constraint; the code is the decorator's `context.code` or the snake_cased constraint name; nested DTO errors get dotted keys (`languageLimits.0.timeLimit`). */
function flattenIssues(errors: ValidationError[], prefix = ''): FieldIssue[] {
  return errors.flatMap((error) => {
    const field = `${prefix}${error.property}`;
    const own = Object.entries(error.constraints ?? {}).map(
      ([name, message]) => ({
        field,
        code:
          (error.contexts?.[name] as { code?: string } | undefined)?.code ??
          snakeCase(name),
        message,
      }),
    );
    return [...own, ...flattenIssues(error.children ?? [], `${field}.`)];
  });
}

export const createValidationPipe = (overrides: ValidationPipeOptions = {}) =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new ValidationFailedError('Validation failed', flattenIssues(errors)),
    ...overrides,
  });

export const validationPipe = createValidationPipe();
