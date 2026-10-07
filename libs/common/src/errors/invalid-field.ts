import { AppError } from './app.error';

/** A 400 `validation_failed` pointing at one field, in the shape the validation pipe produces. */
export const invalidField = (field: string, message: string) =>
  new AppError('validation_failed', 400, message, { [field]: [message] });
