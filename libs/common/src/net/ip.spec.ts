import { ipMatcher, matchesAnyCidr, parseIp, parseRange } from './ip';

describe('parseIp', () => {
  it('reads IPv4 octets, unwraps IPv4-mapped IPv6, and gives the 8 groups of other IPv6', () => {
    expect(parseIp('203.0.113.7')).toEqual({ ipv4: [203, 0, 113, 7] });
    expect(parseIp('::ffff:203.0.113.7')).toEqual({ ipv4: [203, 0, 113, 7] });
    expect(parseIp('::ffff:cb00:7107')).toEqual({ ipv4: [203, 0, 113, 7] });
    expect(parseIp('2001:DB8::1')).toEqual({
      ipv6: [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1],
    });
    expect(parseIp('fe80::1%eth0')).toEqual({
      ipv6: [0xfe80, 0, 0, 0, 0, 0, 0, 1],
    });
    expect(parseIp('64:ff9b::192.0.2.1')).toEqual({
      ipv6: [0x64, 0xff9b, 0, 0, 0, 0, 0xc000, 0x201],
    });
    expect(parseIp('::')).toEqual({ ipv6: [0, 0, 0, 0, 0, 0, 0, 0] });
  });

  it.each(['', 'not an address', '256.0.0.1', '1.2.3', '2001:db8::g'])(
    'refuses %j',
    (value) => expect(parseIp(value)).toBeNull(),
  );
});

describe('parseRange', () => {
  it('reads an address or a network, IPv4 or IPv6', () => {
    expect(parseRange('10.0.0.0/8')).toEqual({
      address: '10.0.0.0',
      version: 4,
      prefix: 8,
    });
    expect(parseRange('2001:db8::/32')).toEqual({
      address: '2001:db8::',
      version: 6,
      prefix: 32,
    });
    expect(parseRange('192.168.1.7')).toEqual({
      address: '192.168.1.7',
      version: 4,
      prefix: null,
    });
    expect(parseRange('192.168.1.7/32')).not.toBeNull();
    expect(parseRange('::/0')).not.toBeNull();
  });

  it('refuses a bare address only when a prefix is required', () => {
    expect(parseRange('10.0.0.0', { prefix: 'required' })).toBeNull();
    expect(parseRange('10.0.0.0/8', { prefix: 'required' })).not.toBeNull();
  });

  it.each([
    '',
    '10.0.0.0/',
    '10.0.0.0/33',
    '::/129',
    'abc/8',
    '10.0.0.0/8/1',
    '10.0.0.0/-1',
    '10.0.0.0/08x',
    '256.0.0.1/8',
  ])('refuses %j', (value) => {
    expect(parseRange(value)).toBeNull();
  });
});

describe('ipMatcher', () => {
  it.each([
    ['10.0.0.0/8', '10.255.0.1', true],
    ['10.0.0.0/8', '11.0.0.1', false],
    ['10.0.0.0/8', '::ffff:10.0.0.5', true],
    ['10.0.0.0/8', '::ffff:11.0.0.5', false],
    ['203.0.113.7', '203.0.113.7', true],
    ['203.0.113.7', '203.0.113.8', false],
    ['2001:db8::/32', '2001:db8:1::5', true],
    ['2001:db8::/32', '2001:db9::1', false],
    ['10.0.0.0/8', 'not-an-ip', false],
  ])('%s matches %s: %s', (entry, ip, expected) =>
    expect(ipMatcher([entry])(ip)).toBe(expected),
  );

  it('matches nothing for an empty list, and refuses a bad entry', () => {
    expect(ipMatcher([])('10.0.0.1')).toBe(false);
    expect(() => ipMatcher(['10.0.0.0/40'])).toThrow('Not an IP or CIDR');
  });
});

describe('matchesAnyCidr', () => {
  it('skips a bare address or a bad entry and still matches the valid ones', () => {
    expect(matchesAnyCidr('10.0.0.1', ['10.0.0.1'])).toBe(false);
    expect(matchesAnyCidr('10.0.0.1', ['not-a-cidr'])).toBe(false);
    expect(matchesAnyCidr('10.0.0.1', ['bad', '10.0.0.0/8'])).toBe(true);
    expect(matchesAnyCidr('10.0.0.1', [])).toBe(false);
  });
});
