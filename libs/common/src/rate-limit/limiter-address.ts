import { parseIp } from '../net/ip';

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
  const parsed = parseIp(text);
  if (!parsed) return text;
  return 'ipv4' in parsed ? parsed.ipv4.join('.') : ipv6Prefix(parsed.ipv6, 64);
}

/**
 * The network of `limiterAddress`'s address: an IPv6 address's /48 (`2001:db8:1::/48`), the most one site or tunnel is
 * handed, and an IPv4 address's /24 (`203.0.113.0/24`), for fairness between networks. With `ipv4: 'address'` an IPv4
 * address stays itself, for budgets a whole /24 (a carrier's shared pool) must not spend together. Anything else is
 * returned unchanged (a missing address as `''`).
 */
export function limiterNetwork(
  ip: string | undefined,
  { ipv4 = 'subnet' }: { ipv4?: 'subnet' | 'address' } = {},
): string {
  const text = ip ?? '';
  const parsed = parseIp(text);
  if (!parsed) return text;
  if ('ipv6' in parsed) return ipv6Prefix(parsed.ipv6, 48);
  return ipv4 === 'address'
    ? parsed.ipv4.join('.')
    : `${parsed.ipv4.slice(0, 3).join('.')}.0/24`;
}
