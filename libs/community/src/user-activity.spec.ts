import {
  activitySessionKey,
  classifyUserAgent,
  csvCell,
  csvLine,
  isTrackedPath,
  redactCredentials,
  stripQuery,
} from './user-activity';

const CHROME_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('user activity rules', () => {
  it('strips the query string and bounds the length', () => {
    expect(
      stripQuery(
        '/api/internal/auth/social/github/callback?code=s3cret&state=x',
      ),
    ).toBe('/api/internal/auth/social/github/callback');
    expect(stripQuery('/a'.repeat(400))).toHaveLength(500);
  });

  it('redacts link credentials in paths and referers, leaving the rest', () => {
    expect(
      redactCredentials('/api/internal/public-rankings/Zk3-secret_token'),
    ).toBe('/api/internal/public-rankings/:token');
    expect(
      redactCredentials('https://oj.example/public-rankings/abc/extra'),
    ).toBe('https://oj.example/public-rankings/:token/extra');
    expect(redactCredentials('/api/internal/contests/r42/ranking')).toBe(
      '/api/internal/contests/r42/ranking',
    );
  });

  it('skips noise, the staff API itself and the SPA polls, tracks everything else', () => {
    for (const path of [
      '/healthz',
      '/media/images/a.png',
      '/api/internal/events/tickets',
      '/api/internal/admin/user-activity/logs',
      '/api/internal/openapi.json',
      '/api/internal/auth/me',
      '/api/internal/site',
    ])
      expect(isTrackedPath(path)).toBe(false);
    for (const path of [
      '/api/internal/problems',
      '/api/internal/admin/settings',
      '/api/internal/site/pages',
      '/api/internal/sitemap',
      '/api/internal/auth/me2',
    ])
      expect(isTrackedPath(path)).toBe(true);
  });

  describe('session keys', () => {
    const base = {
      sessionId: null,
      userId: null,
      ip: '1.2.3.4',
      userAgent: 'UA',
    };
    it('hashes: never contains the session id, is stable, differs per source', () => {
      const cookie = activitySessionKey({
        ...base,
        sessionId: 'raw-session-id',
        userId: 'u1',
      });
      expect(cookie).toMatch(/^[0-9a-f]{64}$/);
      expect(cookie).not.toContain('raw-session-id');
      expect(
        activitySessionKey({
          ...base,
          sessionId: 'raw-session-id',
          userId: 'u1',
        }),
      ).toBe(cookie);
      const token = activitySessionKey({ ...base, userId: 'u1' });
      const anonymous = activitySessionKey(base);
      expect(new Set([cookie, token, anonymous]).size).toBe(3);
    });
    it('keeps anonymous visitors apart by address and agent', () => {
      expect(activitySessionKey(base)).not.toBe(
        activitySessionKey({ ...base, ip: '1.2.3.5' }),
      );
      expect(activitySessionKey(base)).not.toBe(
        activitySessionKey({ ...base, userAgent: 'other' }),
      );
    });
  });

  describe('classifyUserAgent', () => {
    it('reads browser, os and device', () => {
      expect(classifyUserAgent(CHROME_LINUX)).toEqual({
        deviceType: 'desktop',
        browser: 'Chrome',
        os: 'Linux',
      });
      expect(classifyUserAgent(IPHONE)).toEqual({
        deviceType: 'mobile',
        browser: 'Safari',
        os: 'iOS',
      });
    });
    it('recognises bots, tablets and the unknown', () => {
      expect(
        classifyUserAgent(
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        ).deviceType,
      ).toBe('bot');
      expect(classifyUserAgent('curl/8.0').deviceType).toBe('bot');
      expect(
        classifyUserAgent(
          'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari',
        ).deviceType,
      ).toBe('tablet');
      expect(classifyUserAgent('')).toEqual({
        deviceType: 'unknown',
        browser: '',
        os: '',
      });
    });
  });

  describe('csv', () => {
    it('quotes cells with separators and doubles quotes', () => {
      expect(csvCell('a,b')).toBe('"a,b"');
      expect(csvCell('say "hi"')).toBe('"say ""hi"""');
      expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
      expect(csvCell(null)).toBe('');
      expect(csvCell(404)).toBe('404');
    });
    it('neutralises spreadsheet formulas', () => {
      for (const cell of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx'])
        expect(csvCell(cell).replace(/^"/, '').startsWith("'")).toBe(true);
    });
    it('neutralises formulas behind leading whitespace', () => {
      expect(csvCell('=1+1')).toBe("'=1+1");
      expect(csvCell(' =1')).toBe("' =1");
      expect(csvCell(' =1')).toBe("' =1");
      expect(csvCell('\n=1')).toBe(`"'\n=1"`);
      expect(csvCell('\r=1')).toBe(`"'\r=1"`);
      expect(csvCell('\t=1')).toBe("'\t=1");
      expect(csvCell('@x')).toBe("'@x");
    });
    it('leaves plain text and numbers unchanged', () => {
      expect(csvCell('plain')).toBe('plain');
      expect(csvCell(-5)).toBe('-5');
    });
    it('ends lines with CRLF', () => {
      expect(csvLine(['a', 'b'])).toBe('a,b\r\n');
    });
  });
});
