import { ValidateBy } from 'class-validator';
import { isTimeZone } from '@libs/community';

export const IsTimeZone = () =>
  ValidateBy({
    name: 'isTimeZone',
    validator: {
      validate: (value) => isTimeZone(value),
      defaultMessage: () => 'Must be an IANA time zone name.',
    },
  });
