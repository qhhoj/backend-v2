import { Logger } from '@nestjs/common';
import { CSP_REPORT_LIMIT } from '../src/modules/site/csp/csp-report.controller';
import { clearRateLimits } from './contest-fixtures';
import { errorCode, setupApiTest } from './setup';
import type { ApiTest } from './setup';

describe('CSP reports', () => {
  let api: ApiTest;
  let warn: jest.SpyInstance;
  const send = (type: string, body: string) =>
    api
      .http()
      .post('/api/internal/csp-report')
      .set('Content-Type', type)
      .send(body);
  const legacy = JSON.stringify({
    'csp-report': {
      'document-uri': 'http://localhost:5173/problem/a?x=1',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'inline',
    },
  });

  beforeAll(async () => {
    api = await setupApiTest();
  });
  beforeEach(async () => {
    await clearRateLimits(api);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());
  afterAll(() => api.teardown());

  it('takes a legacy report with no sign-in and logs one compact line', async () => {
    await send('application/csp-report', legacy).expect(204);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(
      '"page":"http://localhost:5173/problem/a"',
    );
  });

  it('takes a Reporting API list', async () => {
    const body = JSON.stringify([
      { type: 'csp-violation', body: { effectiveDirective: 'frame-src' } },
    ]);
    await send('application/reports+json', body).expect(204);
    expect(String(warn.mock.calls[0][0])).toContain('"directive":"frame-src"');
  });

  it('answers 204 and logs nothing for a body with no violation', async () => {
    await send('application/csp-report', '{}').expect(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON (400) and one over 16 KiB (413)', async () => {
    const bad = await send('application/csp-report', '{nope');
    expect(bad.status).toBe(400);
    errorCode('validation_failed')(bad);
    const big = await send('application/csp-report', ' '.repeat(20 * 1024));
    expect(big.status).toBe(413);
  });

  it('limits requests per IP', async () => {
    for (let hit = 0; hit < CSP_REPORT_LIMIT; hit += 1)
      await send('application/csp-report', '{}').expect(204);
    const refused = await send('application/csp-report', '{}');
    expect(refused.status).toBe(429);
    errorCode('rate_limited')(refused);
  });
});
