import { feedKeyExpiry, isFeedKeyUsable, parseBasicAuth } from './feed-key';

const basic = (text: string) => `Basic ${Buffer.from(text).toString('base64')}`;
const NOW = new Date('2026-03-01T12:00:00Z');

describe('parseBasicAuth', () => {
  it.each([
    [basic('feed:secret'), { username: 'feed', password: 'secret' }],
    [basic('feed:se:cret'), { username: 'feed', password: 'se:cret' }],
    [basic('feed:'), { username: 'feed', password: '' }],
    [
      `basic ${Buffer.from('a:b').toString('base64')}`,
      { username: 'a', password: 'b' },
    ],
    [basic('nocolon'), null],
    ['Bearer abc', null],
    ['Basic !!!', null],
    ['Basic', null],
    ['', null],
    [undefined, null],
  ])('reads %j as %j', (header, expected) =>
    expect(parseBasicAuth(header)).toEqual(expected),
  );
});

describe('isFeedKeyUsable and feedKeyExpiry', () => {
  const later = new Date(NOW.getTime() + 1000);
  it.each([
    ['live', { revokedAt: null, expiresAt: later }, true],
    [
      'expired',
      { revokedAt: null, expiresAt: new Date(NOW.getTime() - 1) },
      false,
    ],
    ['expiring this very instant', { revokedAt: null, expiresAt: NOW }, false],
    ['revoked', { revokedAt: NOW, expiresAt: later }, false],
  ])('%s is %p', (_name, key, usable) =>
    expect(isFeedKeyUsable(key, NOW)).toBe(usable),
  );

  it('expires after 14 days unless told otherwise', () => {
    expect(feedKeyExpiry(NOW)).toEqual(new Date('2026-03-15T12:00:00Z'));
    expect(feedKeyExpiry(NOW, 1)).toEqual(new Date('2026-03-02T12:00:00Z'));
  });
});
