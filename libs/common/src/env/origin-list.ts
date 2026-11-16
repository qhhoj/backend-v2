/** An exact browser origin as the Origin header sends it: https, lowercase host, a port only when not 443; no path, no wildcard. */
const ORIGIN_SHAPE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]{1,5})?$/;

const isExactOrigin = (entry: string): boolean => {
  if (!ORIGIN_SHAPE.test(entry)) return false;
  try {
    return new URL(entry).origin === entry;
  } catch {
    return false;
  }
};

/** The comma-separated origins in `value` (blank means none), or the entries that are not exact https origins. */
export function parseOriginList(value: string): {
  entries: string[];
  invalid: string[];
} {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { entries, invalid: entries.filter((entry) => !isExactOrigin(entry)) };
}
