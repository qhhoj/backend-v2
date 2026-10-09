import { BlockList, isIP } from 'node:net';

const FAMILIES = { 4: 'ipv4', 6: 'ipv6' } as const;

/** Splits `a.b.c.d` or `a.b.c.d/len` (IPv4 or IPv6); null when it is neither an address nor a CIDR. */
function parseEntry(
  entry: string,
): { address: string; version: 4 | 6; prefix: number | null } | null {
  const [address, length, ...rest] = entry.split('/');
  const version = isIP(address);
  if (version !== 4 && version !== 6) return null;
  if (rest.length) return null;
  if (length === undefined) return { address, version, prefix: null };
  const prefix = /^\d{1,3}$/.test(length) ? Number(length) : NaN;
  if (!(prefix <= (version === 4 ? 32 : 128))) return null;
  return { address, version, prefix };
}

/** The comma-separated IPs/CIDRs in `value` (blank means none), or the entries that are neither. */
export function parseIpList(value: string): {
  entries: string[];
  invalid: string[];
} {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return { entries, invalid: entries.filter((entry) => !parseEntry(entry)) };
}

/** Whether an address (an IPv4-mapped IPv6 one such as `::ffff:10.0.0.5` counts as its IPv4) is in any of the validated `entries`. */
export function ipMatcher(entries: readonly string[]): (ip: string) => boolean {
  const list = new BlockList();
  for (const entry of entries) {
    const parsed = parseEntry(entry);
    if (!parsed) throw new Error(`Not an IP or CIDR: ${entry}`);
    const family = FAMILIES[parsed.version];
    if (parsed.prefix === null) list.addAddress(parsed.address, family);
    else list.addSubnet(parsed.address, parsed.prefix, family);
  }
  return (ip) => {
    const version = isIP(ip);
    return version !== 0 && list.check(ip, FAMILIES[version as 4 | 6]);
  };
}
