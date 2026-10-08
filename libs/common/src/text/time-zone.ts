/** ICU's canonical ID of an IANA zone name (one per zone: aliases and any casing collapse), null when unknown; offsets like `+07:00` are refused (legacy stored names only). Queries and cache keys use it: ICU matches names case-insensitively, Mongo's `$dateToString` does not. Stored and echoed values keep the user's spelling. */
export function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value))
    return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: value,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export const isTimeZone = (value: unknown): value is string =>
  canonicalTimeZone(value) !== null;

const FIELDS = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
} as const;

/** The instant the zone's calendar day of `now` began; two passes settle a day on which the offset changes. */
export function startOfDayIn(timeZone: string, now: Date): Date {
  const format = new Intl.DateTimeFormat('en-US', { timeZone, ...FIELDS });
  const fieldsAt = (instant: Date): Record<string, number> =>
    Object.fromEntries(
      format
        .formatToParts(instant)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
  const offsetAt = (instant: Date): number => {
    const { year, month, day, hour, minute, second } = fieldsAt(instant);
    return (
      Date.UTC(year, month - 1, day, hour, minute, second) -
      Math.floor(instant.getTime() / 1000) * 1000
    );
  };
  const { year, month, day } = fieldsAt(now);
  const midnight = Date.UTC(year, month - 1, day);
  const firstGuess = midnight - offsetAt(new Date(midnight));
  return new Date(midnight - offsetAt(new Date(firstGuess)));
}
