import { registerDecorator } from 'class-validator';
import type { ValidationOptions } from 'class-validator';

const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** An ISO 8601 calendar timestamp with an explicit offset; rejects week/ordinal dates, missing offsets and rolled-over days like 02-30. */
export function isTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [
    ,
    day,
    hour,
    minute,
    second = '0',
    offsetHour = '0',
    offsetMinute = '0',
  ] = match;
  const calendarDay = new Date(`${day}T00:00:00Z`);
  return (
    !Number.isNaN(calendarDay.getTime()) &&
    calendarDay.toISOString().startsWith(day) &&
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60 &&
    Number(offsetHour) < 24 &&
    Number(offsetMinute) < 60 &&
    !Number.isNaN(new Date(value).getTime())
  );
}

export function IsTimestamp(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isTimestamp',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: isTimestamp,
        defaultMessage: () =>
          'Must be an ISO 8601 timestamp with an offset, e.g. 2026-01-01T00:00:00Z.',
      },
    });
}
