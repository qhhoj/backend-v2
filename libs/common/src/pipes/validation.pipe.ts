import { ValidationPipe } from '@nestjs/common';
import type { ValidationPipeOptions } from '@nestjs/common';
import { AppError } from '../errors/app.error';

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
        Object.fromEntries(
          errors.map((error) => [
            error.property,
            Object.values(error.constraints ?? {}),
          ]),
        ),
      ),
    ...overrides,
  });

export const validationPipe = createValidationPipe();
