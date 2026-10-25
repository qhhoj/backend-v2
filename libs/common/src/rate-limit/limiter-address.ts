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

/**
 * The address a per-client rate limit counts under: an IPv4 address as is (also when written IPv4-mapped, `::ffff:a.b.c.d`),
 * an IPv6 address as its /64 (`2001:db8:1:2::/64`), because one host or home line is handed a whole /64. Anything else
 * is returned unchanged.
 */
export function limiterAddress(ip: string): string {
  if (isIPv4(ip)) return ip;
  const address = ip.split('%')[0];
  if (!isIPv6(address)) return ip;
  const groups = ipv6Groups(address);
  if (isMappedIpv4(groups))
    return [
      groups[6] >> 8,
      groups[6] & 255,
      groups[7] >> 8,
      groups[7] & 255,
    ].join('.');
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`;
}
