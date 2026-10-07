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
