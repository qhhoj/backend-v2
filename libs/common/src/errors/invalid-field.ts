import { ValidationFailedError } from './validation-failed.error';

/** A 400 `validation_failed` pointing at one field, in the shape the validation pipe produces. */
export const invalidField = (
  field: string,
  message: string,
  code = 'invalid',
) => new ValidationFailedError(message, [{ field, code, message }]);
