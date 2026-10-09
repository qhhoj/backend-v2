import { BlockList, isIP } from 'node:net';

export interface Cidr {
  network: string;
  prefix: number;
  family: 'ipv4' | 'ipv6';
}

/** `10.0.0.0/8` or `2001:db8::/32`; a bare address (no prefix) is refused so a typo cannot widen to a whole network or narrow to one host silently. */
export function parseCidr(value: string): Cidr | null {
  const [network, prefixText, ...rest] = value.split('/');
  if (rest.length || prefixText === undefined || !/^\d{1,3}$/.test(prefixText))
    return null;
  const family = isIP(network);
  const prefix = Number(prefixText);
  if (family === 0 || prefix > (family === 4 ? 32 : 128)) return null;
  return { network, prefix, family: family === 4 ? 'ipv4' : 'ipv6' };
}

/** False for an empty list, an unparsable entry or address: the check fails closed. Node's `BlockList` matches an IPv4-mapped IPv6 caller (`::ffff:a.b.c.d`, how a dual-stack socket reports IPv4) against IPv4 subnets itself. */
export function matchesAnyCidr(
  address: string,
  cidrs: readonly string[],
): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  const list = new BlockList();
  for (const text of cidrs) {
    const cidr = parseCidr(text);
    if (cidr) list.addSubnet(cidr.network, cidr.prefix, cidr.family);
  }
  return list.check(address, family === 4 ? 'ipv4' : 'ipv6');
}
