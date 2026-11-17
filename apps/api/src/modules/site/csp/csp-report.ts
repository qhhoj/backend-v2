/** One CSP violation, cut down to the fields that tell which rule a page broke. */
export interface CspViolation {
  directive: string;
  blocked: string;
  page: string;
  source: string;
  line: number | null;
  disposition: string;
}

/** A browser sends a few reports per request; the rest of a larger batch is dropped. */
export const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD_LENGTH = 200;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** URLs lose their query and fragment (they can hold share codes and tokens); keywords such as `inline` stay. Everything is cut to a fixed length. */
function compact(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[?#].*$/s, '').slice(0, MAX_FIELD_LENGTH);
}

const lineNumber = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= 0
    ? (value as number)
    : null;

/** The older `report-uri` format: `{ "csp-report": { "violated-directive": ... } }`. */
function fromLegacyReport(report: Fields): CspViolation {
  return {
    directive: compact(
      report['effective-directive'] ?? report['violated-directive'],
    ),
    blocked: compact(report['blocked-uri']),
    page: compact(report['document-uri']),
    source: compact(report['source-file']),
    line: lineNumber(report['line-number']),
    disposition: compact(report['disposition']),
  };
}

/** The Reporting API format: `[{ "type": "csp-violation", "body": { "effectiveDirective": ... } }]`. */
function fromReportingApi(report: Fields): CspViolation | null {
  const { body } = report;
  if (report.type !== 'csp-violation' || !isFields(body)) return null;
  return {
    directive: compact(body.effectiveDirective),
    blocked: compact(body.blockedURL),
    page: compact(body.documentURL),
    source: compact(body.sourceFile),
    line: lineNumber(body.lineNumber),
    disposition: compact(body.disposition),
  };
}

/** Reads a parsed report body of either format; anything that is not a violation report gives an empty list. */
export function parseCspReports(body: unknown): CspViolation[] {
  if (Array.isArray(body))
    return body
      .slice(0, MAX_REPORTS_PER_REQUEST)
      .map((entry) => (isFields(entry) ? fromReportingApi(entry) : null))
      .filter((violation) => violation !== null);
  if (isFields(body) && isFields(body['csp-report']))
    return [fromLegacyReport(body['csp-report'])];
  return [];
}
