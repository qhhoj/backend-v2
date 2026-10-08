import { ValidateBy } from 'class-validator';
import { isUuid } from '@libs/database';

/** Any UUID the database could hold (not only v7), so a stored id of another version is accepted. */
export const IsStoredUuid = () =>
  ValidateBy({
    name: 'isStoredUuid',
    validator: {
      validate: (value) => typeof value === 'string' && isUuid(value),
      defaultMessage: () => 'Not a valid id.',
    },
  });
