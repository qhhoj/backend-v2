import { limiterAddress, limiterNetwork } from './limiter-address';

describe('limiterAddress', () => {
  it('keeps IPv4, unwraps IPv4-mapped IPv6 and counts IPv6 per /64; a missing address is empty', () => {
    const cases: Array<[string | undefined, string]> = [
      ['203.0.113.7', '203.0.113.7'],
      ['::ffff:203.0.113.7', '203.0.113.7'],
      ['::ffff:cb00:7107', '203.0.113.7'],
      ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
      ['2001:0DB8:0001:0002:ffff:1:2:3', '2001:db8:1:2::/64'],
      ['2001:db8::1', '2001:db8:0:0::/64'],
      ['fe80::1%eth0', 'fe80:0:0:0::/64'],
      ['::1', '0:0:0:0::/64'],
      ['not an address', 'not an address'],
      [undefined, ''],
    ];
    expect(cases.map(([ip]) => [ip, limiterAddress(ip)])).toEqual(cases);
  });
});

describe('limiterNetwork', () => {
  it('counts IPv6 per /48 and IPv4 per /24, or per address when asked, unwrapping IPv4-mapped IPv6', () => {
    const cases: Array<[string | undefined, string, string]> = [
      ['203.0.113.7', '203.0.113.0/24', '203.0.113.7'],
      ['::ffff:203.0.113.7', '203.0.113.0/24', '203.0.113.7'],
      ['::ffff:cb00:7107', '203.0.113.0/24', '203.0.113.7'],
      ['2001:db8:1:2::1', '2001:db8:1::/48', '2001:db8:1::/48'],
      ['2001:db8:1:ffff::1', '2001:db8:1::/48', '2001:db8:1::/48'],
      ['not an address', 'not an address', 'not an address'],
      [undefined, '', ''],
    ];
    expect(
      cases.map(([ip]) => [
        ip,
        limiterNetwork(ip),
        limiterNetwork(ip, { ipv4: 'address' }),
      ]),
    ).toEqual(cases);
  });
});
