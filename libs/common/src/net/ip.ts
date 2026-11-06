import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';

const GROUPS = 8;

/** The 8 groups of an IPv6 address as numbers (a trailing dotted IPv4 part becomes the last two). */
function ipv6Groups(address: string): number[] {
  const [head, tail = ''] = address.split('::');
  const parts = (text: string) =>
    text === ''
      ? []
      : text.split(':').flatMap((part) => {
          if (!part.includes('.')) return [parseInt(part, 16)];
          const octets = part.split('.').map(Number);
          return [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
        });
  const front = parts(head);
  const back = parts(tail);
  const zeros = Array<number>(GROUPS - front.length - back.length).fill(0);
  return address.includes('::') ? [...front, ...zeros, ...back] : front;
}

const isMappedIpv4 = (groups: number[]) =>
  groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;

export type ParsedIp = { ipv4: number[] } | { ipv6: number[] };

/** The 4 octets of an IPv4 address (also when written IPv4-mapped, `::ffff:a.b.c.d`), the 8 groups of another IPv6 address, or null. */
export function parseIp(ip: string): ParsedIp | null {
  if (isIPv4(ip)) return { ipv4: ip.split('.').map(Number) };
  const address = ip.split('%')[0];
  if (!isIPv6(address)) return null;
  const groups = ipv6Groups(address);
  if (!isMappedIpv4(groups)) return { ipv6: groups };
  return {
    ipv4: [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255],
  };
}

const FAMILIES = { 4: 'ipv4', 6: 'ipv6' } as const;

export interface IpRange {
  address: string;
  version: 4 | 6;
  /** Null for a single address. */
  prefix: number | null;
}

/** `a.b.c.d` or `a.b.c.d/len` (IPv4 or IPv6); null when it is neither an address nor a CIDR. With `prefix: 'required'` a bare address is refused too, so a typo cannot widen to a whole network or narrow to one host silently. */
export function parseRange(
  entry: string,
  { prefix: mode = 'optional' }: { prefix?: 'optional' | 'required' } = {},
): IpRange | null {
  const [address, length, ...rest] = entry.split('/');
  const version = isIP(address);
  if (version !== 4 && version !== 6) return null;
  if (rest.length) return null;
  if (length === undefined)
    return mode === 'required' ? null : { address, version, prefix: null };
  const prefix = /^\d{1,3}$/.test(length) ? Number(length) : NaN;
  if (!(prefix <= (version === 4 ? 32 : 128))) return null;
  return { address, version, prefix };
}

/** Whether an address (an IPv4-mapped IPv6 one such as `::ffff:10.0.0.5` counts as its IPv4) is in any of the validated `entries` (addresses or CIDRs). */
export function ipMatcher(entries: readonly string[]): (ip: string) => boolean {
  const list = new BlockList();
  for (const entry of entries) {
    const range = parseRange(entry);
    if (!range) throw new Error(`Not an IP or CIDR: ${entry}`);
    const family = FAMILIES[range.version];
    if (range.prefix === null) list.addAddress(range.address, family);
    else list.addSubnet(range.address, range.prefix, family);
  }
  return (ip) => {
    const version = isIP(ip);
    return version !== 0 && list.check(ip, FAMILIES[version as 4 | 6]);
  };
}

/** Whether `address` is in any of the `cidrs` (each with a prefix). False for an empty list, an unparsable address, and for an unparsable entry, which is skipped: the check fails closed. */
export function matchesAnyCidr(
  address: string,
  cidrs: readonly string[],
): boolean {
  const valid = cidrs.filter((cidr) =>
    parseRange(cidr, { prefix: 'required' }),
  );
  return ipMatcher(valid)(address);
}
