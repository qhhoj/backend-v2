import { isIPv4, isIPv6 } from 'node:net';

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

type ParsedAddress = { ipv4: number[] } | { ipv6: number[] } | null;

/** The 4 octets of an IPv4 address (also when written IPv4-mapped, `::ffff:a.b.c.d`), the 8 groups of another IPv6 address, or null. */
function parseAddress(ip: string): ParsedAddress {
  if (isIPv4(ip)) return { ipv4: ip.split('.').map(Number) };
  const address = ip.split('%')[0];
  if (!isIPv6(address)) return null;
  const groups = ipv6Groups(address);
  if (!isMappedIpv4(groups)) return { ipv6: groups };
  return {
    ipv4: [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255],
  };
}

const ipv6Prefix = (groups: number[], length: number) =>
  `${groups
    .slice(0, length / 16)
    .map((group) => group.toString(16))
    .join(':')}::/${length}`;

/**
 * The address a per-client rate limit counts under: an IPv4 address as is (also when written IPv4-mapped, `::ffff:a.b.c.d`),
 * an IPv6 address as its /64 (`2001:db8:1:2::/64`), because one host or home line is handed a whole /64. Anything else
 * is returned unchanged (a missing address as `''`).
 */
export function limiterAddress(ip: string | undefined): string {
  const text = ip ?? '';
  const parsed = parseAddress(text);
  if (!parsed) return text;
  return 'ipv4' in parsed ? parsed.ipv4.join('.') : ipv6Prefix(parsed.ipv6, 64);
}

/**
 * The network of `limiterAddress`'s address, for fairness between networks: an IPv4 address's /24
 * (`203.0.113.0/24`) and an IPv6 address's /48 (`2001:db8:1::/48`), the most one site or tunnel is handed.
 * Anything else is returned unchanged (a missing address as `''`).
 */
export function limiterNetwork(ip: string | undefined): string {
  const text = ip ?? '';
  const parsed = parseAddress(text);
  if (!parsed) return text;
  return 'ipv4' in parsed
    ? `${parsed.ipv4.slice(0, 3).join('.')}.0/24`
    : ipv6Prefix(parsed.ipv6, 48);
}
