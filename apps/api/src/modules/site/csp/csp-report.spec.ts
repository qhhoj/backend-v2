import { MAX_REPORTS_PER_REQUEST, parseCspReports } from './csp-report';

describe('parseCspReports', () => {
  it('reads the legacy report-uri format and drops query and fragment', () => {
    expect(
      parseCspReports({
        'csp-report': {
          'document-uri': 'https://oj.test/s/abc?token=secret#x',
          'violated-directive': 'script-src-elem',
          'effective-directive': 'script-src-elem',
          'blocked-uri': 'inline',
          'source-file': 'https://oj.test/a.js?v=1',
          'line-number': 7,
          disposition: 'report',
        },
      }),
    ).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'inline',
        page: 'https://oj.test/s/abc',
        source: 'https://oj.test/a.js',
        line: 7,
        disposition: 'report',
      },
    ]);
  });

  it('reads the Reporting API list and skips other report types', () => {
    const violations = parseCspReports([
      { type: 'deprecation', body: {} },
      {
        type: 'csp-violation',
        body: {
          documentURL: 'https://oj.test/problem/a',
          effectiveDirective: 'frame-src',
          blockedURL: 'https://evil.test/x?y=1',
          lineNumber: 'bad',
        },
      },
    ]);
    expect(violations).toEqual([
      {
        directive: 'frame-src',
        blocked: 'https://evil.test/x',
        page: 'https://oj.test/problem/a',
        source: '',
        line: null,
        disposition: '',
      },
    ]);
  });

  it('caps field length and the number of reports', () => {
    const body = Array.from({ length: 50 }, () => ({
      type: 'csp-violation',
      body: { blockedURL: 'x'.repeat(5000) },
    }));
    const violations = parseCspReports(body);
    expect(violations).toHaveLength(MAX_REPORTS_PER_REQUEST);
    expect(violations[0].blocked).toHaveLength(200);
  });

  it.each([null, 'text', 42, {}, { 'csp-report': 'x' }, [null, 3]])(
    'gives no violation for %j',
    (body) => {
      expect(parseCspReports(body)).toEqual([]);
    },
  );
});
