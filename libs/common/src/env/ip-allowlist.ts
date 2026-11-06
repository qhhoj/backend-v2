import { parseRange } from '../net/ip';

/** The comma-separated IPs/CIDRs in `value` (blank means none), or the entries that are neither. */
export function parseIpList(value: string): {
  entries: string[];
  invalid: string[];
} {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { entries, invalid: entries.filter((entry) => !parseRange(entry)) };
}
