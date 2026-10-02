import { ValidationPipe } from '@nestjs/common';
import { AppError } from './errors/app.error';

export const validationPipe = new ValidationPipe({
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
});
