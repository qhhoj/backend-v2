import { matchesAnyCidr, parseCidr } from './cidr';

describe('parseCidr', () => {
  it('reads IPv4 and IPv6 networks with a prefix', () => {
    expect(parseCidr('10.0.0.0/8')).toEqual({
      network: '10.0.0.0',
      prefix: 8,
      family: 'ipv4',
    });
    expect(parseCidr('2001:db8::/32')).toEqual({
      network: '2001:db8::',
      prefix: 32,
      family: 'ipv6',
    });
    expect(parseCidr('192.168.1.7/32')).not.toBeNull();
  });
  it.each([
    '',
    '10.0.0.0',
    '10.0.0.0/',
    '10.0.0.0/33',
    '::/129',
    'abc/8',
    '10.0.0.0/8/1',
    '10.0.0.0/-1',
    '10.0.0.0/08x',
    '256.0.0.1/8',
  ])('refuses %j', (value) => {
    expect(parseCidr(value)).toBeNull();
  });
});

describe('matchesAnyCidr', () => {
  it('matches inside, not outside, a network', () => {
    expect(matchesAnyCidr('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(matchesAnyCidr('11.0.0.1', ['10.0.0.0/8'])).toBe(false);
    expect(matchesAnyCidr('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(matchesAnyCidr('2002::1', ['2001:db8::/32'])).toBe(false);
  });
  it('treats an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(matchesAnyCidr('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(matchesAnyCidr('::ffff:11.1.2.3', ['10.0.0.0/8'])).toBe(false);
  });
  it('matches any of several, and nothing for an empty list, a bad entry or a bad address', () => {
    expect(matchesAnyCidr('172.16.0.9', ['10.0.0.0/8', '172.16.0.0/12'])).toBe(
      true,
    );
    expect(matchesAnyCidr('10.0.0.1', [])).toBe(false);
    expect(matchesAnyCidr('10.0.0.1', ['not-a-cidr'])).toBe(false);
    expect(matchesAnyCidr('not-an-ip', ['0.0.0.0/0'])).toBe(false);
  });
});
