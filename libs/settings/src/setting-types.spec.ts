import {
  mailFromType,
  oauthClientType,
  oneOfType,
  optionalDatetimeType,
  optionalTextType,
  optionalUrlType,
  optionalUuidType,
  SettingError,
  webhooksType,
} from './setting-types';

const messageOf = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(SettingError);
    return (error as Error).message;
  }
  throw new Error('expected a SettingError');
};

describe('setting types', () => {
  it('takes an empty value or a safe URL', () => {
    for (const ok of ['', 'https://api.example.test', 'http://127.0.0.1:9/h'])
      expect(optionalUrlType.parse(ok)).toBe(ok);
    for (const bad of ['http://example.com', 'ftp://x.test', 'nonsense', 5])
      expect(() => optionalUrlType.parse(bad)).toThrow(SettingError);
  });

  it('takes an empty value or a record id, lower-cased', () => {
    expect(optionalUuidType.parse('')).toBe('');
    expect(optionalUuidType.parse('01A12501-DB2B-744C-BC51-4805439A680F')).toBe(
      '01a12501-db2b-744c-bc51-4805439a680f',
    );
    for (const bad of ['Org Admin', '01a12501-db2b-744c', 5, null])
      expect(() => optionalUuidType.parse(bad)).toThrow(SettingError);
  });

  it('takes a bare address or "Name <address>" and nothing that can inject a header', () => {
    for (const ok of ['a@b.co', 'QHHOJ <no-reply@qhhoj.local>'])
      expect(mailFromType.parse(ok)).toBe(ok);
    for (const bad of [
      'x@b.co\r\nBcc: a@b.co',
      'Name <not-an-address>',
      'Name <a@b.co> extra',
      '',
    ])
      expect(() => mailFromType.parse(bad)).toThrow(SettingError);
  });

  it('takes event to URL pairs and never echoes a URL in an error', () => {
    const map = {
      default: 'https://hook.test/a',
      on_new_comment: 'http://localhost:9/b',
    };
    expect(webhooksType.parse(map)).toEqual(map);
    expect(webhooksType.parse({})).toEqual({});
    const message = messageOf(() =>
      webhooksType.parse({ default: 'http://secret.example/token123' }),
    );
    expect(message).not.toContain('secret.example');
    expect(message).not.toContain('token123');
    expect(() => webhooksType.parse({ on_Bad: 'https://x.test' })).toThrow(
      SettingError,
    );
    expect(() => webhooksType.parse([])).toThrow(SettingError);
  });

  it('needs an id and a secret for an enabled OAuth client and refuses unknown fields', () => {
    const off = { enabled: false, clientId: '', clientSecret: '' };
    expect(oauthClientType.parse(off)).toEqual(off);
    const on = { enabled: true, clientId: 'id', clientSecret: 'secret' };
    expect(oauthClientType.parse(on)).toEqual(on);
    expect(() => oauthClientType.parse({ ...on, clientSecret: '' })).toThrow(
      SettingError,
    );
    expect(() => oauthClientType.parse({ ...on, extra: 1 })).toThrow(
      SettingError,
    );
  });
});

/** Outbound URLs (webhooks, pwned API): the NODE_ENV check is made per call, so each mode is set in place. */
describe('outbound URL safety', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const inMode = (nodeEnv: string, action: () => void) => {
    process.env.NODE_ENV = nodeEnv;
    try {
      action();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
  };

  describe('in production', () => {
    const refusedUrls = [
      'http://hooks.example.test/a',
      'https://localhost:8443/a',
      'https://api.localhost/a',
      'https://localhost./a',
      'https://api.localhost./a',
      'https://127.0.0.1/a',
      'https://127.1/a',
      'https://10.0.0.5/a',
      'https://172.16.0.1/a',
      'https://172.31.255.255/a',
      'https://192.168.1.10/a',
      'https://169.254.169.254/a',
      'https://0.0.0.0/a',
      'https://[::1]/a',
      'https://[::]/a',
      'https://[fc00::1]/a',
      'https://[fd12:3456::1]/a',
      'https://[fe80::1]/a',
      'https://[febf::1]/a',
      'https://[::ffff:127.0.0.1]/a',
    ];

    it.each(refusedUrls)(
      'refuses %s through the webhook and pwned types',
      (url) => {
        inMode('production', () => {
          expect(() => webhooksType.parse({ default: url })).toThrow(
            SettingError,
          );
          expect(() => optionalUrlType.parse(url)).toThrow(SettingError);
        });
      },
    );

    it('accepts public https hosts and addresses just outside the internal ranges', () => {
      inMode('production', () => {
        const allowed = [
          'https://hooks.example.test/a',
          'https://172.32.0.1/a',
          'https://192.169.0.1/a',
          'https://11.0.0.1/a',
          'https://[2606:4700::1111]/a',
          'https://[fec0::1]/a',
        ];
        for (const url of allowed) expect(optionalUrlType.parse(url)).toBe(url);
      });
    });
  });

  describe('outside production', () => {
    it('keeps localhost and loopback over http, and private https, allowed', () => {
      inMode('development', () => {
        for (const url of [
          'http://localhost:9/b',
          'http://127.0.0.1:9/h',
          'https://localhost:8443/b',
          'https://10.0.0.5/a',
        ])
          expect(optionalUrlType.parse(url)).toBe(url);
      });
    });

    it('still refuses plain http to any other host', () => {
      inMode('development', () => {
        for (const url of ['http://example.com/a', 'http://10.0.0.5/a'])
          expect(() => optionalUrlType.parse(url)).toThrow(SettingError);
      });
    });
  });
});

describe('optionalDatetimeType', () => {
  it('accepts empty (off) and normalises an instant with an offset to UTC', () => {
    expect(optionalDatetimeType.parse('')).toBe('');
    expect(optionalDatetimeType.parse('2026-10-10T08:00:00+07:00')).toBe(
      '2026-10-10T01:00:00.000Z',
    );
    expect(optionalDatetimeType.parse('2026-10-10T01:00:00Z')).toBe(
      '2026-10-10T01:00:00.000Z',
    );
  });
  it('refuses a local time without an offset, a date alone, nonsense and non-strings', () => {
    for (const bad of [
      '2026-10-10T08:00:00',
      '2026-10-10',
      'tomorrow',
      '2026-13-40T00:00:00Z',
      '2026-02-31T10:00:00Z',
      '2026-04-31T10:00:00+07:00',
      1,
      null,
      true,
    ])
      expect(messageOf(() => optionalDatetimeType.parse(bad))).toContain(
        'ISO 8601',
      );
  });
});

describe('oneOfType', () => {
  const mode = oneOfType(['warn', 'enforce'] as const);
  it('accepts a listed value and refuses everything else', () => {
    expect(mode.parse('enforce')).toBe('enforce');
    expect(messageOf(() => mode.parse('Enforce'))).toBe(
      'Must be one of: warn, enforce.',
    );
    expect(messageOf(() => mode.parse(1))).toContain('Must be one of');
    expect(messageOf(() => mode.parse(null))).toContain('Must be one of');
  });

  it('takes short one-line text, trimmed, and refuses control characters or overlong values', () => {
    const text = optionalTextType(10);
    expect(text.parse('')).toBe('');
    expect(text.parse('  abc123 ')).toBe('abc123');
    expect(messageOf(() => text.parse('a\nb'))).toContain('one line');
    expect(messageOf(() => text.parse('x'.repeat(11)))).toContain('at most 10');
    expect(messageOf(() => text.parse(5))).toContain('at most 10');
  });
});
